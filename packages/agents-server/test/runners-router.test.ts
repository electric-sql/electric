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
    owner_principal: `/principal/user%3Aowner%40example.com`,
    label: `Local runner`,
    kind: `local` as const,
    admin_status: `enabled` as const,
    liveness: `offline` as const,
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
        owner_principal: input.ownerPrincipal,
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
    getActiveClaimsForRunner: vi.fn(async () => []),
    getRunnerDiagnostics: vi.fn(async () => null),
    getDispatchStatsForRunner: vi.fn(async () => ({
      entities_with_active_claim: 0,
      entities_with_outstanding_wake: 0,
      entities_with_pending_work: 0,
    })),
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
      url: `/principal/user%3Aowner%40example.com`,
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
        owner_principal: `/principal/user%3Aother%40example.com`,
        label: `Local runner`,
      }),
      buildContext({
        principal: {
          kind: `user`,
          id: `owner@example.com`,
          key: `user:owner@example.com`,
          url: `/principal/user%3Aowner%40example.com`,
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
        url: `/principal/user%3Aowner%40example.com`,
      },
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_principal: `/principal/user%3Aowner%40example.com`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.entityManager.registry.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `runner-1`,
        ownerPrincipal: `/principal/user%3Aowner%40example.com`,
      })
    )
    expect(ctx.streamClient.ensure).toHaveBeenCalledWith(
      `/runners/runner-1/wake`,
      { contentType: `application/json` }
    )
  })

  it(`returns the persisted wake stream offset when registering a runner`, async () => {
    const ctx = buildContext()
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      wake_stream_offset: `42`,
      last_seen_at: new Date(0).toISOString(),
      liveness_lease_expires_at: new Date(60_000).toISOString(),
      updated_at: new Date(0).toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_principal: `/principal/user%3Aowner%40example.com`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.wake_stream_offset).toBe(`42`)
  })

  it(`canonicalizes legacy owner_principal URLs on registration`, async () => {
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_principal: `/principal/user:owner@example.com`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(201)
    expect(ctx.entityManager.registry.createRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerPrincipal: `/principal/user%3Aowner%40example.com`,
      })
    )
  })

  it(`infers runner owner from the authenticated user when omitted`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user%3Aowner%40example.com`,
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
        ownerPrincipal: `/principal/user%3Aowner%40example.com`,
      })
    )
  })

  it(`canonicalizes legacy owner_principal URLs when listing runners`, async () => {
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(
        `GET`,
        `/_electric/runners?owner_principal=${encodeURIComponent(`/principal/user:owner@example.com`)}`
      ),
      ctx
    )

    expect(response.status).toBe(200)
    expect(ctx.entityManager.registry.listRunners).toHaveBeenCalledWith({
      ownerPrincipal: `/principal/user%3Aowner%40example.com`,
    })
  })

  it(`rejects unauthenticated runner listing`, async () => {
    const ctx = buildContext({ principal: undefined as any })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners`),
      ctx
    )

    expect(response.status).toBe(401)
    expect(ctx.entityManager.registry.listRunners).not.toHaveBeenCalled()
  })

  it(`returns runner health with diagnostics and claim state`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
      runner({
        admin_status: `enabled`,
      })
    )
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      diagnostics: {
        stream_connected: true,
        reconnect_count: 0,
        last_heartbeat_ok: true,
      },
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.runner).toMatchObject({
      id: `runner-1`,
      liveness_status: `online`,
    })
    expect(body.client).toMatchObject({ stream_connected: true })
    expect(body.claims).toMatchObject({ active_count: 0 })
    expect(body.health).toMatchObject({ status: `healthy`, issues: [] })
  })

  it(`sanitizes heartbeat diagnostics before storing them`, async () => {
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/heartbeat`, {
        lease_ms: 30_000,
        wake_stream_offset: `123`,
        diagnostics: {
          status: `streaming`,
          stream_connected: `yes`,
          stream_connected_since: null,
          reconnect_count: `2`,
          last_heartbeat_ok: false,
          last_claim_result: `invalid`,
          last_error: `heartbeat failed`,
          claims_failed: 1,
          events_received: -1,
          extra: { noisy: true },
        },
      }),
      ctx
    )

    expect(response.status).toBe(200)
    const heartbeatInput = vi.mocked(ctx.entityManager.registry.heartbeatRunner)
      .mock.calls[0]![0]
    expect(heartbeatInput).toMatchObject({
      runnerId: `runner-1`,
      wakeStreamOffset: `123`,
      diagnostics: {
        status: `streaming`,
        stream_connected_since: null,
        last_heartbeat_ok: false,
        last_error: `heartbeat failed`,
        claims_failed: 1,
      },
    })
    expect(heartbeatInput.diagnostics).not.toHaveProperty(`stream_connected`)
    expect(heartbeatInput.diagnostics).not.toHaveProperty(`reconnect_count`)
    expect(heartbeatInput.diagnostics).not.toHaveProperty(`last_claim_result`)
    expect(heartbeatInput.diagnostics).not.toHaveProperty(`events_received`)
    expect(heartbeatInput.diagnostics).not.toHaveProperty(`extra`)
  })

  it(`sanitizes stored runner diagnostics before returning health`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
      runner({
        admin_status: `enabled`,
      })
    )
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      diagnostics: {
        stream_connected: `yes`,
        reconnect_count: 6,
        last_heartbeat_ok: false,
        last_error: 500,
      },
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.client).toEqual({
      reconnect_count: 6,
      last_heartbeat_ok: false,
    })
    expect(body.health.issues).toContain(`Client reports last heartbeat failed`)
    expect(body.health.issues).toContain(`Client has reconnected 6 times`)
  })

  it(`returns unhealthy when runner lease is expired`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
      runner({
        admin_status: `enabled`,
      })
    )
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() - 10_000).toISOString(),
      last_seen_at: new Date(Date.now() - 15_000).toISOString(),
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.health.status).toBe(`unhealthy`)
    expect(body.health.issues.length).toBeGreaterThan(0)
  })

  it(`rejects unauthenticated runner claims`, async () => {
    const ctx = buildContext({ principal: undefined as any })
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/one/main`,
        generation: 7,
      }),
      ctx
    )

    expect(response.status).toBe(401)
    expect(ctx.streamClient.claimSubscription).not.toHaveBeenCalled()
  })

  it(`rejects unauthenticated runner registration for an explicit owner`, async () => {
    const ctx = buildContext({ principal: undefined as any })
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_principal: `/principal/user%3Aowner%40example.com`,
        label: `Local runner`,
      }),
      ctx
    )

    expect(response.status).toBe(401)
    expect(ctx.entityManager.registry.createRunner).not.toHaveBeenCalled()
  })

  it(`returns DS claim conflicts as 409 responses`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user%3Aowner%40example.com`,
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
        url: `/principal/user%3Aowner%40example.com`,
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
      callback: `http://server/_electric/wake-callbacks/wake-1`,
      claimToken: `claim-token`,
    })
    expect(body.streams).toEqual([{ path: `/chat/one/main`, offset: `12` }])
    expect(ctx.entityManager.registry.materializeActiveClaim).toHaveBeenCalled()
    expect(ctx.entityManager.registry.updateStatus).toHaveBeenCalledWith(
      `/chat/one`,
      `running`
    )
  })

  it(`releases paused entity claims without dispatching pending work`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.streamClient.claimSubscription).mockResolvedValue({
      wake_id: `wake-paused`,
      generation: 7,
      token: `claim-token`,
      streams: [{ path: `chat/paused/main`, tail_offset: `12` }],
    })
    vi.mocked(ctx.entityManager.registry.getEntityByStream).mockResolvedValue({
      url: `/chat/paused`,
      type: `chat`,
      status: `paused`,
      streams: { main: `/chat/paused/main`, error: `/chat/paused/error` },
      subscription_id: `runner:runner-1`,
      write_token: `entity-token`,
      tags: {},
      created_at: 1,
      updated_at: 1,
    })

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners/runner-1/claim`, {
        subscription_id: `runner:runner-1`,
        stream: `chat/paused/main`,
        generation: 7,
      }),
      ctx
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ done: true })
    expect(ctx.streamClient.releaseSubscription).toHaveBeenCalledWith(
      `runner:runner-1`,
      `claim-token`,
      {
        wake_id: `wake-paused`,
        generation: 7,
      }
    )
    expect(
      ctx.entityManager.registry.materializeActiveClaim
    ).not.toHaveBeenCalled()
    expect(ctx.entityManager.registry.updateStatus).not.toHaveBeenCalled()
  })

  it(`rejects invalid owner_principal with 400`, async () => {
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/runners`, {
        id: `runner-1`,
        owner_principal: `/principal/not-a-valid-key`,
        label: `Local runner`,
      }),
      buildContext({
        principal: {
          kind: `user`,
          id: `owner@example.com`,
          key: `user:owner@example.com`,
          url: `/principal/user%3Aowner%40example.com`,
        },
      })
    )

    expect(response.status).toBe(400)
  })

  it(`returns unhealthy when runner is disabled`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
      runner({
        admin_status: `disabled`,
      })
    )
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.health.status).toBe(`unhealthy`)
    expect(body.health.issues).toContain(`Runner is disabled`)
    expect(body.runner.liveness_status).toBe(`offline`)
  })

  it(`returns degraded when stream is disconnected`, async () => {
    const ctx = buildContext()
    vi.mocked(ctx.entityManager.registry.getRunner).mockResolvedValue(
      runner({
        admin_status: `enabled`,
      })
    )
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: new Date(Date.now() + 30_000).toISOString(),
      last_seen_at: new Date().toISOString(),
      diagnostics: {
        stream_connected: false,
        reconnect_count: 2,
        last_heartbeat_ok: true,
      },
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.health.status).toBe(`degraded`)
    expect(body.health.issues).toContain(`Client reports stream disconnected`)
  })

  it(`ignores invalid runner lease timestamps in health output`, async () => {
    const ctx = buildContext()
    vi.mocked(
      ctx.entityManager.registry.getRunnerDiagnostics
    ).mockResolvedValue({
      runner_id: `runner-1`,
      owner_principal: `/principal/user%3Aowner%40example.com`,
      liveness_lease_expires_at: `not-a-date`,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/runners/runner-1/health`),
      ctx
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>
    expect(body.runner.lease_expires_at).toBeNull()
    expect(body.runner.lease_remaining_ms).toBeNull()
    expect(body.runner.liveness_status).toBe(`offline`)
  })

  it(`uses the pending stream from multi-stream claim responses`, async () => {
    const ctx = buildContext({
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user%3Aowner%40example.com`,
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
