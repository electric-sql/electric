import { describe, expect, it, vi } from 'vitest'
import { globalRouter } from '../src/routing/global-router'
import { DurableStreamsSubscriptionError } from '../src/stream-client'
import type { TenantContext } from '../src/routing/context'

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://server${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function runner(overrides: Record<string, unknown> = {}) {
  return {
    id: `runner-1`,
    owner_user_id: `user:owner@example.com`,
    label: `Local runner`,
    kind: `local`,
    admin_status: `enabled`,
    liveness: `offline`,
    wake_stream: `/runners/runner-1/wake`,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  }
}

function buildContext(overrides: Partial<TenantContext> = {}): TenantContext {
  const registry = {
    createRunner: vi.fn(async (input) =>
      runner({
        id: input.id,
        owner_user_id: input.ownerUserId,
        label: input.label,
        wake_stream: input.wakeStream ?? `/runners/${input.id}/wake`,
      })
    ),
    getRunner: vi.fn(async () => runner()),
    listRunners: vi.fn(async () => [runner()]),
    heartbeatRunner: vi.fn(async () =>
      runner({ last_seen_at: new Date(0).toISOString() })
    ),
    setRunnerAdminStatus: vi.fn(async (_id, status) =>
      runner({ admin_status: status })
    ),
    getEntityByStream: vi.fn(),
    materializeActiveClaim: vi.fn(),
    updateStatus: vi.fn(),
  }
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
      url: `/principal/user:owner@example.com`,
    },
    publicUrl: `http://server`,
    durableStreamsUrl: `http://durable.local`,
    durableStreamsDispatcher: undefined as any,
    pgDb: {
      insert: vi.fn(() => insertChain),
    } as any,
    entityManager: { registry } as any,
    streamClient: {
      ensure: vi.fn(async () => undefined),
      claimSubscription: vi.fn(async () => null),
      releaseSubscription: vi.fn(async () => ({})),
    } as any,
    runtime: undefined as any,
    entityBridgeManager: undefined as any,
    isShuttingDown: () => false,
    ...overrides,
  }
}

describe(`runner routes`, () => {
  it(`rejects authenticated runner registration for another owner`, async () => {
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_user_id: `other@example.com`,
        label: `Local runner`,
      }),
      buildContext({
        principal: {
          kind: `user`,
          id: `owner@example.com`,
          key: `user:owner@example.com`,
          url: `/principal/user:owner@example.com`,
        },
      })
    )

    expect(response.status).toBe(403)
  })

  it(`registers a runner and ensures its wake stream`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user:owner@example.com`,
      },
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_user_id: `user:owner@example.com`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.entityManager.registry.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `runner-1`,
        ownerUserId: `user:owner@example.com`,
      })
    )
    expect(ctx.streamClient.ensure).toHaveBeenCalledWith(
      `/runners/runner-1/wake`,
      { contentType: `application/json` }
    )
  })

  it(`infers runner owner from the authenticated user when omitted`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user:owner@example.com`,
      },
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.entityManager.registry.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: `user:owner@example.com`,
      })
    )
  })

  it(`requires authentication to claim runner work`, async () => {
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/one/main`,
        generation: 7,
      }),
      buildContext({ principal: undefined as any })
    )

    expect(response.status).toBe(401)
  })

  it(`returns DS claim conflicts as 409 responses`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user:owner@example.com`,
      },
    })
    vi.mocked(ctx.streamClient.claimSubscription).mockRejectedValue(
      new DurableStreamsSubscriptionError(
        `Subscription claim failed`,
        409,
        JSON.stringify({
          error: {
            code: `NO_PENDING_WORK`,
            message: `Subscription has no pending work`,
          },
        })
      )
    )

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/one/main`,
        generation: 7,
      }),
      ctx
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: `NO_PENDING_WORK`,
        message: `Subscription has no pending work`,
      },
    })
    expect(
      ctx.entityManager.registry.materializeActiveClaim
    ).not.toHaveBeenCalled()
  })

  it(`claims compact DS wake events and returns enriched notifications`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user:owner@example.com`,
      },
    })
    vi.mocked(ctx.streamClient.claimSubscription).mockResolvedValue({
      wake_id: `wake-1`,
      generation: 7,
      token: `claim-token`,
      streams: [{ path: `chat/one/main`, tail_offset: `12` }],
      lease_ttl_ms: 30_000,
    })
    vi.mocked(ctx.entityManager.registry.getEntityByStream).mockResolvedValue({
      url: `/chat/one`,
      type: `chat`,
      status: `idle`,
      streams: { main: `/chat/one/main`, error: `/chat/one/error` },
      subscription_id: `runner:runner-1`,
      write_token: `entity-token`,
      tags: {},
      created_at: 1,
      updated_at: 1,
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/one/main`,
        generation: 7,
        ts: 123,
      }),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      consumerId: `wake-1`,
      epoch: 7,
      wakeId: `wake-1`,
      streamPath: `/chat/one/main`,
      callback: `http://server/_electric/callback-forward/wake-1`,
      claimToken: `claim-token`,
    })
    expect(body.streams).toEqual([{ path: `/chat/one/main`, offset: `12` }])
    expect(ctx.entityManager.registry.materializeActiveClaim).toHaveBeenCalled()
    expect(ctx.entityManager.registry.updateStatus).toHaveBeenCalledWith(
      `/chat/one`,
      `running`
    )
  })

  it(`uses the pending stream from multi-stream claim responses`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user:owner@example.com`,
      },
    })
    vi.mocked(ctx.streamClient.claimSubscription).mockResolvedValue({
      wake_id: `wake-1`,
      generation: 7,
      token: `claim-token`,
      streams: [
        {
          path: `chat/old/main`,
          tail_offset: `10`,
          has_pending: false,
        },
        {
          path: `chat/new/main`,
          tail_offset: `20`,
          has_pending: true,
        },
      ],
      lease_ttl_ms: 30_000,
    })
    vi.mocked(ctx.entityManager.registry.getEntityByStream).mockResolvedValue({
      url: `/chat/new`,
      type: `chat`,
      status: `idle`,
      streams: { main: `/chat/new/main`, error: `/chat/new/error` },
      subscription_id: `runner:runner-1`,
      write_token: `entity-token`,
      tags: {},
      created_at: 1,
      updated_at: 1,
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/new/main`,
        generation: 7,
      }),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.streamPath).toBe(`/chat/new/main`)
    expect(ctx.entityManager.registry.getEntityByStream).toHaveBeenCalledWith(
      `/chat/new/main`
    )
  })
})
