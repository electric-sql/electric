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
      from: () => Promise.resolve([]),
    }),
  }
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
      durableStreamsUrl: `https://api.electric-sql.cloud/v1/stream/svc-coastal-stork`,
    })

    expect(runtime.serviceId).toBe(`svc-coastal-stork`)
    expect(host.getTenant(`svc-coastal-stork`)).toBe(runtime)
    expect(runtime.streamClient.baseUrl).toBe(
      `https://api.electric-sql.cloud/v1/stream/svc-coastal-stork`
    )
    expect(runtime.wakeRegistry).toBe(host.wakeRegistry)
    expect(runtime.manager.registry.tenantId).toBe(`svc-coastal-stork`)
  })

  it(`uses an explicitly supplied tenant stream client`, async () => {
    const streamClient = new StreamClient(
      `https://api.electric-sql.cloud/v1/stream/svc-direct-client`
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
      durableStreamsUrl: `https://api.electric-sql.cloud/v1/stream/svc-before-start`,
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
})
