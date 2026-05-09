import { EventEmitter } from 'node:events'
import { setImmediate as flushImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ElectricAgentsServer } from '../src/server'

function createRequest(body?: unknown, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>
    method: string
    url: string
  }
  req.headers = headers
  req.method = `POST`
  req.url = `/_electric/callback-forward/consumer-1`

  process.nextTick(() => {
    if (body !== undefined) {
      req.emit(`data`, Buffer.from(JSON.stringify(body)))
    }
    req.emit(`end`)
  })

  return req as any
}

function createResponse() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any
}

function jsonResponse(res: ReturnType<typeof createResponse>) {
  const body = res.end.mock.calls[0]?.[0]
  if (body instanceof Uint8Array) {
    return JSON.parse(new TextDecoder().decode(body))
  }
  return typeof body === `string` ? JSON.parse(body) : body
}

function createPgDb(callbackRows: Array<Record<string, unknown>>) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => callbackRows),
        })),
      })),
    })),
  }
}

function makeRunnerTargetEntity() {
  return {
    url: `/chat/one`,
    type: `chat`,
    status: `idle`,
    streams: {
      main: `/chat/one/main`,
      error: `/chat/one/error`,
    },
    subscription_id: `chat-handler`,
    dispatch_policy: {
      targets: [{ type: `runner`, runnerId: `kyle-mac` }],
    },
    write_token: `entity-write-token`,
    tags: {},
    spawn_args: {},
    created_at: 1,
    updated_at: 1,
  }
}

describe(`ElectricAgentsServer callback-forward runner claim gate`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createServerHarness(options?: {
    authenticatedUserId?: string | null
    runner?: Record<string, unknown> | null
    entity?: Record<string, unknown> | null
    releaseResult?: Record<string, unknown>
  }) {
    const entity =
      options?.entity === undefined ? makeRunnerTargetEntity() : options.entity
    const runner =
      options?.runner === undefined
        ? {
            id: `kyle-mac`,
            owner_user_id: `user-kyle`,
            admin_status: `enabled`,
          }
        : options.runner
    const authenticateRequest = vi.fn(() =>
      options?.authenticatedUserId === undefined
        ? { userId: `user-kyle` }
        : options.authenticatedUserId
          ? { userId: options.authenticatedUserId }
          : null
    )
    const server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable-streams.test`,
      port: 0,
      postgresUrl: `postgres://unused`,
      authenticateRequest,
    })
    const registry = {
      getEntityByStream: vi.fn().mockResolvedValue(entity),
      getRunner: vi.fn().mockResolvedValue(runner),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      materializeActiveClaim: vi.fn().mockResolvedValue(undefined),
      materializeHeartbeatClaim: vi.fn().mockResolvedValue(true),
      materializeReleasedClaim: vi
        .fn()
        .mockResolvedValue(
          options?.releaseResult ?? { matched: true, pendingSourceStreams: [] }
        ),
    }
    const dispatchWakeRouter = {
      resolveSingleTarget: vi.fn((policy) => policy.targets[0]),
      mintNotificationForEntity: vi.fn().mockResolvedValue({
        notification: {
          consumerId: `entity:chat:one`,
          epoch: 2,
          wakeId: `wake-follow-up`,
          streamPath: `/chat/one/main`,
          streams: [{ path: `/chat/one/main`, offset: `8` }],
          callback: `http://durable-streams.test/callback/follow-up`,
          claimToken: `claim-follow-up`,
        },
      }),
      enrichNotificationForEntity: vi.fn(async (notification) => notification),
      dispatchToTarget: vi.fn().mockResolvedValue({ status: `queued` }),
    }
    ;(server as any).electricAgentsManager = { registry }
    ;(server as any).dispatchWakeRouter = dispatchWakeRouter
    ;(server as any).pgDb = createPgDb([
      {
        consumerId: `consumer-1`,
        callbackUrl: `http://durable-streams.test/callback/consumer-1`,
        primaryStream: `/chat/one/main`,
      },
    ])

    return { server, registry, authenticateRequest, dispatchWakeRouter }
  }

  it(`rejects runner-target claim requests with the wrong runner id before forwarding`, async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal(`fetch`, fetchMock)
    const { server, registry } = createServerHarness()
    const req = createRequest(
      { wakeId: `wake-1`, epoch: 1 },
      {
        authorization: `Bearer user-session`,
        'electric-runner-id': `other-runner`,
        'electric-claim-token': `claim-secret`,
      }
    )
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(registry.getRunner).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `RUNNER_MISMATCH`,
        message: `Runner id header must match the entity dispatch target`,
      },
    })
  })

  it(`rejects runner-target claim requests from a non-owner before forwarding`, async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal(`fetch`, fetchMock)
    const { server, registry } = createServerHarness({
      authenticatedUserId: `user-other`,
    })
    const req = createRequest(
      { wakeId: `wake-1`, epoch: 1 },
      {
        authorization: `Bearer user-session`,
        'x-runner-id': `kyle-mac`,
        'electric-claim-token': `claim-secret`,
      }
    )
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(registry.getRunner).toHaveBeenCalledWith(`kyle-mac`)
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `FORBIDDEN`,
        message: `Authenticated user does not own the target runner`,
      },
    })
  })

  it(`forwards claim requests with Electric-Claim-Token rewritten to Authorization`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, epoch: 1, wakeId: `wake-1` }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const { server, registry, authenticateRequest } = createServerHarness()
    const req = createRequest(
      { wakeId: `wake-1`, epoch: 1 },
      {
        authorization: `Bearer user-session`,
        'electric-runner-id': `kyle-mac`,
        'electric-claim-token': `claim-secret`,
      }
    )
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )

    expect(authenticateRequest).toHaveBeenCalledWith(req)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(`http://durable-streams.test/callback/consumer-1`)
    const headers = (init as RequestInit).headers as Headers
    expect(headers.get(`authorization`)).toBe(`Bearer claim-secret`)
    expect(headers.has(`electric-claim-token`)).toBe(false)
    expect(registry.updateStatus).toHaveBeenCalledWith(`/chat/one`, `running`)
    expect(registry.materializeActiveClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerId: `consumer-1`,
        epoch: 1,
        entityUrl: `/chat/one`,
        streamPath: `/chat/one/main`,
        wakeId: `wake-1`,
        runnerId: `kyle-mac`,
      })
    )
    expect(jsonResponse(res)).toMatchObject({
      ok: true,
      writeToken: expect.not.stringMatching(/^entity-write-token$/),
    })
  })

  it(`dispatches pending coalesced wake after matched done for an entity with dispatch_policy`, async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
    vi.stubGlobal(`fetch`, fetchMock)
    const pending = [{ path: `/chat/one/main`, offset: `8` }]
    const { server, registry, dispatchWakeRouter } = createServerHarness({
      releaseResult: {
        matched: true,
        pendingSourceStreams: pending,
        pendingReason: `message`,
      },
    })
    const req = createRequest({
      done: true,
      epoch: 1,
      acks: [{ path: `/chat/one/main`, offset: `7` }],
    })
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )
    await flushImmediate()

    expect(registry.materializeReleasedClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerId: `consumer-1`,
        epoch: 1,
        entityUrl: `/chat/one`,
        streamPath: `/chat/one/main`,
        ackedStreams: [{ path: `/chat/one/main`, offset: `7` }],
      })
    )
    expect(dispatchWakeRouter.mintNotificationForEntity).toHaveBeenCalledWith(
      expect.objectContaining({ url: `/chat/one` }),
      { streams: pending, triggerEvent: `message` }
    )
    expect(dispatchWakeRouter.dispatchToTarget).toHaveBeenCalledWith(
      { type: `runner`, runnerId: `kyle-mac` },
      expect.objectContaining({ wakeId: `wake-follow-up` }),
      expect.objectContaining({ url: `/chat/one` })
    )
    expect(jsonResponse(res)).toEqual({ ok: true })
  })

  it(`does not dispatch after done when no pending work remains`, async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    vi.stubGlobal(`fetch`, fetchMock)
    const { server, dispatchWakeRouter } = createServerHarness({
      releaseResult: { matched: true, pendingSourceStreams: [] },
    })
    const req = createRequest({ done: true, epoch: 1 })
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )
    await flushImmediate()

    expect(dispatchWakeRouter.mintNotificationForEntity).not.toHaveBeenCalled()
    expect(dispatchWakeRouter.dispatchToTarget).not.toHaveBeenCalled()
  })

  it(`does not dispatch pending work after done when the entity has no dispatch_policy`, async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 })
      )
    vi.stubGlobal(`fetch`, fetchMock)
    const entity = makeRunnerTargetEntity()
    delete (entity as { dispatch_policy?: unknown }).dispatch_policy
    const { server, dispatchWakeRouter } = createServerHarness({
      entity,
      releaseResult: {
        matched: true,
        pendingSourceStreams: [{ path: `/chat/one/main`, offset: `8` }],
      },
    })
    const req = createRequest({ done: true, epoch: 1 })
    const res = createResponse()

    await (server as any).handleCallbackForward(
      `/_electric/callback-forward/consumer-1`,
      req,
      res
    )
    await flushImmediate()

    expect(dispatchWakeRouter.mintNotificationForEntity).not.toHaveBeenCalled()
    expect(dispatchWakeRouter.dispatchToTarget).not.toHaveBeenCalled()
  })
})
