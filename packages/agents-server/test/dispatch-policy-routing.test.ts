import { describe, expect, it, vi } from 'vitest'
import { globalRouter } from '../src/routing/global-router'
import { DurableStreamsSubscriptionError } from '../src/stream-client'
import type { TenantContext } from '../src/routing/context'
import type {
  DispatchPolicy,
  ElectricAgentsEntity,
} from '../src/electric-agents-types'

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://server${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function entity(
  dispatchPolicy?: DispatchPolicy,
  id = `one`
): ElectricAgentsEntity & { txid: number } {
  return {
    url: `/chat/${id}`,
    type: `chat`,
    status: `idle`,
    streams: { main: `/chat/${id}/main`, error: `/chat/${id}/error` },
    subscription_id: `chat-handler`,
    dispatch_policy: dispatchPolicy,
    write_token: `write-token`,
    tags: {},
    created_at: 1,
    updated_at: 1,
    txid: 1,
  }
}

function buildContext(overrides: Partial<TenantContext> = {}): TenantContext {
  const insertChain = {
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(async () => undefined),
    })),
  }
  return {
    service: `tenant-test`,
    principal: {
      kind: `user`,
      id: `owner@example.com`,
      key: `user:owner@example.com`,
      url: `/principal/user%3Aowner%40example.com`,
    },
    publicUrl: `http://server`,
    durableStreamsUrl: `http://durable.local`,
    durableStreamsDispatcher: undefined as any,
    pgDb: {
      insert: vi.fn(() => insertChain),
    } as any,
    entityManager: {
      registry: {
        getEntityType: vi.fn(async () => ({
          name: `chat`,
          description: `Chat`,
          revision: 1,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        })),
        getEntity: vi.fn(async () => null),
        updateEntityDispatchPolicy: vi.fn(async (_url, policy) =>
          entity(policy)
        ),
        getRunner: vi.fn(async () => ({
          id: `runner-1`,
          owner_principal: `/principal/user%3Aowner%40example.com`,
          label: `Local runner`,
          kind: `local`,
          admin_status: `enabled`,
          wake_stream: `/runners/runner-1/wake`,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        })),
      },
      ensurePrincipal: vi.fn(async () => undefined),
      spawn: vi.fn(async (_type, req) =>
        entity(req.dispatch_policy, req.instance_id ?? `one`)
      ),
    } as any,
    streamClient: {
      getSubscription: vi.fn(async () => null),
      putSubscription: vi.fn(async () => ({})),
      addSubscriptionStreams: vi.fn(async () => ({})),
      removeSubscriptionStream: vi.fn(async () => ({})),
      ensure: vi.fn(async () => undefined),
    } as any,
    runtime: undefined as any,
    entityBridgeManager: undefined as any,
    isShuttingDown: () => false,
    ...overrides,
  }
}

describe(`dispatch policy routing`, () => {
  it(`creates pull-wake subscriptions for runner-targeted spawns`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.streamClient.ensure).toHaveBeenCalledWith(
      `/runners/runner-1/wake`,
      { contentType: `application/json` }
    )
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/),
      expect.objectContaining({
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })
    )
  })

  it(`uses separate pull-wake subscriptions for separate runner-targeted entities`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()

    const first = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
      }),
      ctx
    )
    const second = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/two`, {
        dispatch_policy: dispatchPolicy,
      }),
      ctx
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const subscriptionIds = vi
      .mocked(ctx.streamClient.putSubscription)
      .mock.calls.map(([subscriptionId]) => subscriptionId)
    expect(subscriptionIds).toHaveLength(2)
    expect(subscriptionIds[0]).toMatch(/^runner:runner-1:/)
    expect(subscriptionIds[1]).toMatch(/^runner:runner-1:/)
    expect(subscriptionIds[0]).not.toBe(subscriptionIds[1])
  })

  it(`creates webhook subscriptions and stores the original target`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `webhook`, url: `http://runtime.local/wake` }],
    }
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^webhook:/),
      expect.objectContaining({
        type: `webhook`,
        streams: [`/chat/one/main`],
        webhook: {
          url: expect.stringMatching(
            /^http:\/\/server\/_electric\/subscription-webhooks\/webhook%3A/
          ),
        },
      })
    )
    expect(ctx.pgDb.insert).toHaveBeenCalled()
  })

  it(`links pull-wake dispatch before sending spawn initialMessage`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
        initialMessage: `hello`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.entityManager.spawn).toHaveBeenCalledWith(
      `chat`,
      expect.objectContaining({
        dispatch_policy: dispatchPolicy,
        initialMessage: undefined,
      })
    )
    expect(ctx.entityManager.send).toHaveBeenCalledWith(`/chat/one`, {
      from: `/principal/user%3Aowner%40example.com`,
      payload: `hello`,
    })
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/),
      expect.objectContaining({
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })
    )
    expect(
      (ctx.streamClient.putSubscription as any).mock.invocationCallOrder[0]
    ).toBeLessThan((ctx.entityManager.send as any).mock.invocationCallOrder[0])
  })

  it(`links webhook dispatch before sending spawn initialMessage`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `webhook`, url: `http://runtime.local/wake` }],
    }
    const ctx = buildContext()
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
        initialMessage: `hello`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^webhook:/),
      expect.objectContaining({
        type: `webhook`,
        streams: [`/chat/one/main`],
      })
    )
    expect(ctx.entityManager.send).toHaveBeenCalledWith(`/chat/one`, {
      from: `/principal/user%3Aowner%40example.com`,
      payload: `hello`,
    })
    expect(
      (ctx.streamClient.putSubscription as any).mock.invocationCallOrder[0]
    ).toBeLessThan((ctx.entityManager.send as any).mock.invocationCallOrder[0])
  })

  it(`links legacy entities through the type default before sending`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()
    ;(ctx.entityManager.registry.getEntity as any).mockResolvedValue(
      entity(undefined)
    )
    ;(ctx.entityManager.registry.getEntityType as any).mockResolvedValue({
      name: `chat`,
      description: `Chat`,
      default_dispatch_policy: dispatchPolicy,
      revision: 1,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    })
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entities/chat/one/send`, {
        payload: `hello`,
      }),
      ctx
    )

    expect(response.status).toBe(204)
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/),
      expect.objectContaining({
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })
    )
    expect(
      ctx.entityManager.registry.updateEntityDispatchPolicy
    ).toHaveBeenCalledWith(`/chat/one`, dispatchPolicy)
    expect(ctx.entityManager.send).toHaveBeenCalledWith(
      `/chat/one`,
      expect.objectContaining({ payload: `hello` })
    )
  })

  it(`recreates missing runner dispatch subscriptions before sending`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()
    ;(ctx.entityManager.registry.getEntity as any).mockResolvedValue(
      entity(dispatchPolicy)
    )
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entities/chat/one/send`, {
        payload: `hello`,
      }),
      ctx
    )

    expect(response.status).toBe(204)
    expect(ctx.streamClient.getSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/)
    )
    expect(ctx.streamClient.putSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/),
      expect.objectContaining({
        type: `pull-wake`,
        streams: [`/chat/one/main`],
        wake_stream: `/runners/runner-1/wake`,
      })
    )
    expect(ctx.streamClient.addSubscriptionStreams).not.toHaveBeenCalled()
    expect(ctx.entityManager.send).toHaveBeenCalledWith(
      `/chat/one`,
      expect.objectContaining({ payload: `hello` })
    )
  })

  it(`does not re-add already linked runner streams before sending`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()
    ;(ctx.entityManager.registry.getEntity as any).mockResolvedValue(
      entity(dispatchPolicy)
    )
    ;(ctx.streamClient.getSubscription as any).mockResolvedValue({
      streams: [{ path: `tenant-test/chat/one/main` }],
    })
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entities/chat/one/send`, {
        payload: `hello`,
      }),
      ctx
    )

    expect(response.status).toBe(204)
    expect(ctx.streamClient.getSubscription).toHaveBeenCalledWith(
      expect.stringMatching(/^runner:runner-1:/)
    )
    expect(ctx.streamClient.putSubscription).not.toHaveBeenCalled()
    expect(ctx.streamClient.addSubscriptionStreams).not.toHaveBeenCalled()
    expect(ctx.streamClient.removeSubscriptionStream).not.toHaveBeenCalled()
    expect(ctx.entityManager.send).toHaveBeenCalledWith(
      `/chat/one`,
      expect.objectContaining({ payload: `hello` })
    )

    const second = await globalRouter.fetch(
      request(`POST`, `/_electric/entities/chat/one/send`, {
        payload: `again`,
      }),
      ctx
    )

    expect(second.status).toBe(204)
    expect(ctx.streamClient.getSubscription).toHaveBeenCalledTimes(1)
    expect(ctx.streamClient.ensure).toHaveBeenCalledTimes(2)
    expect(ctx.entityManager.send).toHaveBeenCalledWith(
      `/chat/one`,
      expect.objectContaining({ payload: `again` })
    )
  })

  it(`treats runner subscription create conflicts as an idempotent spawn link`, async () => {
    const dispatchPolicy: DispatchPolicy = {
      targets: [{ type: `runner`, runnerId: `runner-1` }],
    }
    const ctx = buildContext()
    ;(ctx.streamClient.getSubscription as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        streams: [{ path: `tenant-test/chat/one/main` }],
      })
    ;(ctx.streamClient.putSubscription as any).mockRejectedValueOnce(
      new DurableStreamsSubscriptionError(
        `Subscription creation failed`,
        409,
        JSON.stringify({
          error: {
            code: `SUBSCRIPTION_ALREADY_EXISTS`,
            message: `Subscription already exists`,
          },
        })
      )
    )
    ctx.entityManager.send = vi.fn(async () => undefined)

    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/chat/one`, {
        dispatch_policy: dispatchPolicy,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.streamClient.addSubscriptionStreams).not.toHaveBeenCalled()
  })
})
