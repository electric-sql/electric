import { describe, expect, it, vi } from 'vitest'
import { AgentsHost } from '../src/host'
import { StreamClient } from '../src/stream-client'

function createMockDb(): any {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: 1 }]),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () =>
        Object.assign(Promise.resolve([]), {
          where: () =>
            Object.assign(Promise.resolve([]), {
              limit: () => Promise.resolve([]),
              orderBy: () => Promise.resolve([]),
            }),
        }),
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe(`AgentsHost`, () => {
  it(`builds tenant runtimes with shared registries and tenant stream clients`, async () => {
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    expect(host.getTenant(`svc-coastal-stork`)).toBeUndefined()

    const runtime = await host.registerTenant({
      serviceId: `svc-coastal-stork`,
      durableStreamsUrl: `https://streams.test/v1/streams/svc-coastal-stork`,
    })

    expect(runtime.serviceId).toBe(`svc-coastal-stork`)
    expect(host.getTenant(`svc-coastal-stork`)).toBe(runtime)
    expect(runtime.streamClient.baseUrl).toBe(
      `https://streams.test/v1/streams/svc-coastal-stork`
    )
    expect(runtime.wakeRegistry).toBe(host.wakeRegistry)
    expect(runtime.manager.registry.tenantId).toBe(`svc-coastal-stork`)
  })

  it(`uses an explicitly supplied tenant stream client`, async () => {
    const streamClient = new StreamClient(
      `https://streams.test/v1/streams/svc-direct-client`
    )
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    const runtime = await host.registerTenant({
      serviceId: `svc-direct-client`,
      streamClient,
    })

    expect(runtime.streamClient).toBe(streamClient)
  })

  it(`starts already-registered tenant runtime work when host starts`, async () => {
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    const runtime = await host.registerTenant({
      serviceId: `svc-before-start`,
      durableStreamsUrl: `https://streams.test/v1/streams/svc-before-start`,
    })
    const rehydrate = vi
      .spyOn(runtime, `rehydrateCronSchedules`)
      .mockResolvedValue(undefined)
    const loadTenantBridges = vi
      .spyOn(host.entityProjector, `loadTenantBridges`)
      .mockResolvedValue(undefined)
    vi.spyOn(host.scheduler, `start`).mockResolvedValue(undefined)
    vi.spyOn(host.scheduler, `stop`).mockResolvedValue(undefined)
    vi.spyOn(host.tagStreamOutboxDrainer, `start`).mockImplementation(() => {})
    vi.spyOn(host.tagStreamOutboxDrainer, `stop`).mockResolvedValue(undefined)

    await host.start()
    await host.stop()

    expect(rehydrate).toHaveBeenCalledOnce()
    expect(loadTenantBridges).toHaveBeenCalledWith(
      `svc-before-start`,
      runtime.registry
    )
  })

  it(`throws when requiring a tenant before explicit registration`, () => {
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    expect(() => host.requireTenant(`svc-missing`)).toThrow(
      `AgentsHost tenant "svc-missing" is not registered`
    )
  })

  it(`waits for in-flight tenant registration before unregistering`, async () => {
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })
    const runtime = {
      serviceId: `svc-race`,
      stop: vi.fn(async () => undefined),
    }
    const createRuntime = deferred<typeof runtime>()
    vi.spyOn(host as any, `createTenantRuntime`).mockReturnValue(
      createRuntime.promise
    )

    const registration = host.registerTenant({
      serviceId: `svc-race`,
      durableStreamsUrl: `https://streams.test/v1/streams/svc-race`,
    })
    await Promise.resolve()

    const unregistration = host.unregisterTenant(`svc-race`)
    await Promise.resolve()

    expect(runtime.stop).not.toHaveBeenCalled()
    expect(host.getTenant(`svc-race`)).toBeUndefined()

    createRuntime.resolve(runtime)
    await expect(registration).resolves.toBe(runtime)
    await unregistration

    expect(runtime.stop).toHaveBeenCalledOnce()
    expect(host.getTenant(`svc-race`)).toBeUndefined()
  })

  it(`applies durableStreamsRouting adapter to per-tenant subscription payloads`, async () => {
    const adapter = {
      streamUrl: ({ durableStreamsUrl }: { durableStreamsUrl: string }) =>
        new URL(durableStreamsUrl),
      controlUrl: ({ durableStreamsUrl }: { durableStreamsUrl: string }) =>
        new URL(durableStreamsUrl),
      toBackendStreamPath: (serviceId: string, path: string) => {
        const normalized = path.replace(/^\/+/, ``)
        if (
          normalized === serviceId ||
          normalized.startsWith(`${serviceId}/`)
        ) {
          return normalized
        }
        return `${serviceId}/${normalized}`
      },
      toRuntimeStreamPath: (serviceId: string, path: string) => {
        const normalized = path.replace(/^\/+/, ``)
        return normalized.startsWith(`${serviceId}/`)
          ? normalized.slice(serviceId.length + 1)
          : normalized
      },
    }

    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    const runtime = await host.registerTenant({
      serviceId: `svc-routed-tenant`,
      durableStreamsUrl: `https://streams.test/v1/stream/svc-routed-tenant`,
      durableStreamsRouting: adapter,
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-host` }), {
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      await runtime.streamClient.putSubscription(`sub-host`, {
        type: `webhook`,
        streams: [`/discord-bot/abc/main`],
        webhook: { url: `http://agent.local/webhook` },
      })

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        type: `webhook`,
        streams: [`svc-routed-tenant/discord-bot/abc/main`],
      })
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`omits the routing adapter when durableStreamsRouting is not provided`, async () => {
    const host = new AgentsHost({
      db: createMockDb(),
      pgClient: vi.fn() as any,
    })

    const runtime = await host.registerTenant({
      serviceId: `svc-default-tenant`,
      durableStreamsUrl: `https://streams.test/v1/stream/svc-default-tenant`,
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscription_id: `sub-default` }), {
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      await runtime.streamClient.putSubscription(`sub-default`, {
        type: `webhook`,
        streams: [`/discord-bot/abc/main`],
        webhook: { url: `http://agent.local/webhook` },
      })

      const [, init] = fetchMock.mock.calls[0]!
      expect(JSON.parse(init?.body as string)).toMatchObject({
        streams: [`discord-bot/abc/main`],
      })
    } finally {
      fetchMock.mockRestore()
    }
  })
})
