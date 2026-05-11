import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/electric-agents-manager'
import { ElectricAgentsRoutes } from '../src/electric-agents-routes'

function createRequest(
  body?: unknown,
  headers: Record<string, string> = {},
  url?: string
) {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>
    url?: string
  }
  req.headers = headers
  req.url = url

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
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any
}

function jsonResponse(res: ReturnType<typeof createResponse>) {
  const body = res.end.mock.calls[0]?.[0]
  return typeof body === `string` ? JSON.parse(body) : body
}

function makeEntity(url: string, dispatchPolicy?: unknown) {
  const type = url.split(`/`)[1]!
  return {
    url,
    type,
    status: `idle`,
    streams: {
      main: `${url}/main`,
      error: `${url}/error`,
    },
    subscription_id: `${type}-handler`,
    dispatch_policy: dispatchPolicy,
    write_token: `write-${url}`,
    tags: {},
    spawn_args: {},
    created_at: 1,
    updated_at: 1,
  }
}

function makeRunner(id: string, ownerUserId: string) {
  return {
    id,
    owner_user_id: ownerUserId,
    label: `${id} label`,
    kind: `local`,
    admin_status: `enabled`,
    liveness: `offline`,
    wake_stream: `/runners/${id}/wake`,
    created_at: `2026-01-01T00:00:00.000Z`,
    updated_at: `2026-01-01T00:00:00.000Z`,
  }
}

describe(`ElectricAgentsRoutes runner registration`, () => {
  it(`uses the authenticated user as runner owner`, async () => {
    const manager = {
      registry: {
        getRunner: vi.fn().mockResolvedValue(null),
        createRunner: vi.fn().mockResolvedValue({
          id: `kyle-mac`,
          owner_user_id: `user-kyle`,
          label: `Kyle's Mac`,
          kind: `local`,
          admin_status: `enabled`,
          wake_stream: `/runners/kyle-mac/wake`,
          created_at: `2026-01-01T00:00:00.000Z`,
          updated_at: `2026-01-01T00:00:00.000Z`,
        }),
      },
    } as any
    const authenticateRequest = vi.fn().mockReturnValue({ userId: `user-kyle` })
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      authenticateRequest
    )
    const req = createRequest({ id: `kyle-mac`, label: `Kyle's Mac` })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(authenticateRequest).toHaveBeenCalledWith(req)
    expect(manager.registry.createRunner).toHaveBeenCalledWith({
      id: `kyle-mac`,
      ownerUserId: `user-kyle`,
      label: `Kyle's Mac`,
      kind: `local`,
      adminStatus: `enabled`,
      wakeStream: `/runners/kyle-mac/wake`,
    })
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      'content-type': `application/json`,
    })
  })

  it(`rejects supplied owner_user_id that differs from the authenticated user`, async () => {
    const manager = {
      registry: {
        getRunner: vi.fn(),
        createRunner: vi.fn(),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest({
      id: `kyle-mac`,
      label: `Kyle's Mac`,
      owner_user_id: `user-other`,
    })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.createRunner).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `OWNER_MISMATCH`,
        message: `owner_user_id must match the authenticated user`,
      },
    })
  })

  it(`rejects re-registering an existing runner owned by another authenticated user`, async () => {
    const manager = {
      registry: {
        getRunner: vi.fn().mockResolvedValue({
          id: `shared-mac`,
          owner_user_id: `user-other`,
          admin_status: `enabled`,
        }),
        createRunner: vi.fn(),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest({ id: `shared-mac`, label: `Shared Mac` })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.createRunner).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `OWNER_MISMATCH`,
        message: `Authenticated user does not own the existing runner`,
      },
    })
  })
})

describe(`ElectricAgentsRoutes runner management ownership`, () => {
  it(`requires authentication before listing runners when configured`, async () => {
    const manager = {
      registry: {
        listRunners: vi.fn(),
      },
    } as any
    const authenticateRequest = vi.fn().mockReturnValue(null)
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      authenticateRequest
    )
    const req = createRequest(undefined, {}, `/_electric/runners`)
    const res = createResponse()

    const handled = await routes.handleRequest(
      `GET`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(authenticateRequest).toHaveBeenCalledWith(req)
    expect(manager.registry.listRunners).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      'content-type': `application/json`,
    })
  })

  it(`lists only the authenticated user's runners`, async () => {
    const runners = [makeRunner(`kyle-mac`, `user-kyle`)]
    const manager = {
      registry: {
        listRunners: vi.fn().mockResolvedValue(runners),
      },
    } as any
    const authenticateRequest = vi.fn().mockReturnValue({ userId: `user-kyle` })
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      authenticateRequest
    )
    const req = createRequest(undefined, {}, `/_electric/runners`)
    const res = createResponse()

    const handled = await routes.handleRequest(
      `GET`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.listRunners).toHaveBeenCalledWith({
      ownerUserId: `user-kyle`,
    })
    expect(jsonResponse(res)).toEqual(runners)
  })

  it(`rejects listing runners for a different supplied owner`, async () => {
    const manager = {
      registry: {
        listRunners: vi.fn(),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest(
      undefined,
      {},
      `/_electric/runners?owner_user_id=user-other`
    )
    const res = createResponse()

    const handled = await routes.handleRequest(
      `GET`,
      `/_electric/runners`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.listRunners).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `OWNER_MISMATCH`,
        message: `owner_user_id must match the authenticated user`,
      },
    })
  })

  it(`returns 403 when getting another user's runner`, async () => {
    const manager = {
      registry: {
        getRunner: vi
          .fn()
          .mockResolvedValue(makeRunner(`shared-mac`, `user-other`)),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest()
    const res = createResponse()

    const handled = await routes.handleRequest(
      `GET`,
      `/_electric/runners/shared-mac`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.getRunner).toHaveBeenCalledWith(`shared-mac`)
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `FORBIDDEN`,
        message: `Authenticated user does not own the runner`,
      },
    })
  })

  it(`returns 404 when an authenticated runner lookup is missing`, async () => {
    const manager = {
      registry: {
        getRunner: vi.fn().mockResolvedValue(null),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest()
    const res = createResponse()

    const handled = await routes.handleRequest(
      `GET`,
      `/_electric/runners/missing-mac`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(res.writeHead).toHaveBeenCalledWith(404, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `NOT_FOUND`,
        message: `Runner not found`,
      },
    })
  })

  it(`rejects runner heartbeat from a non-owner before updating liveness`, async () => {
    const manager = {
      registry: {
        getRunner: vi
          .fn()
          .mockResolvedValue(makeRunner(`kyle-mac`, `user-kyle`)),
        heartbeatRunner: vi.fn(),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-other` })
    )
    const req = createRequest({ lease_ms: 1000 })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners/kyle-mac/heartbeat`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.heartbeatRunner).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
  })

  it(`rejects runner disable from a non-owner before changing status`, async () => {
    const manager = {
      registry: {
        getRunner: vi
          .fn()
          .mockResolvedValue(makeRunner(`kyle-mac`, `user-kyle`)),
        setRunnerAdminStatus: vi.fn(),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-other` })
    )
    const req = createRequest()
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners/kyle-mac/disable`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.setRunnerAdminStatus).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
  })

  it(`allows the runner owner to disable their runner`, async () => {
    const disabledRunner = {
      ...makeRunner(`kyle-mac`, `user-kyle`),
      admin_status: `disabled`,
    }
    const manager = {
      registry: {
        getRunner: vi
          .fn()
          .mockResolvedValue(makeRunner(`kyle-mac`, `user-kyle`)),
        setRunnerAdminStatus: vi.fn().mockResolvedValue(disabledRunner),
      },
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest()
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/_electric/runners/kyle-mac/disable`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.registry.setRunnerAdminStatus).toHaveBeenCalledWith(
      `kyle-mac`,
      `disabled`
    )
    expect(jsonResponse(res)).toEqual(disabledRunner)
  })

  it(`keeps no-hook scaffold behavior for management routes`, async () => {
    const runners = [makeRunner(`other-mac`, `user-other`)]
    const manager = {
      registry: {
        listRunners: vi.fn().mockResolvedValue(runners),
        getRunner: vi.fn().mockResolvedValue(runners[0]),
      },
    } as any
    const routes = new ElectricAgentsRoutes(manager)
    const listReq = createRequest(
      undefined,
      {},
      `/_electric/runners?owner_user_id=user-other`
    )
    const listRes = createResponse()

    const listHandled = await routes.handleRequest(
      `GET`,
      `/_electric/runners`,
      listReq,
      listRes
    )

    expect(listHandled).toBe(true)
    expect(manager.registry.listRunners).toHaveBeenCalledWith({
      ownerUserId: `user-other`,
    })
    expect(jsonResponse(listRes)).toEqual(runners)

    const getReq = createRequest()
    const getRes = createResponse()
    const getHandled = await routes.handleRequest(
      `GET`,
      `/_electric/runners/other-mac`,
      getReq,
      getRes
    )

    expect(getHandled).toBe(true)
    expect(manager.registry.getRunner).toHaveBeenCalledWith(`other-mac`)
    expect(jsonResponse(getRes)).toEqual(runners[0])
  })
})

describe(`ElectricAgentsRoutes spawn runner safety gate`, () => {
  const runnerPolicy = {
    targets: [{ type: `runner`, runnerId: `kyle-mac` }],
  } as const

  it(`requires authentication for explicit runner-target dispatch`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
        getEntity: vi.fn(),
        getRunner: vi.fn(),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(runnerPolicy),
      spawn: vi.fn(),
    } as any
    const authenticateRequest = vi.fn().mockReturnValue(null)
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      authenticateRequest
    )
    const req = createRequest({ dispatch_policy: runnerPolicy })
    const res = createResponse()

    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(authenticateRequest).toHaveBeenCalledWith(req)
    expect(manager.registry.getRunner).not.toHaveBeenCalled()
    expect(manager.spawn).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(401, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `AUTHENTICATION_REQUIRED`,
        message: `Authentication is required to spawn runner-targeted work`,
      },
    })
  })

  it(`rejects explicit runner-target dispatch by a non-owner`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
        getEntity: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `kyle-mac`,
          owner_user_id: `user-kyle`,
          admin_status: `enabled`,
        }),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(runnerPolicy),
      spawn: vi.fn(),
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-other` })
    )
    const req = createRequest({ dispatch_policy: runnerPolicy })
    const res = createResponse()

    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(manager.registry.getRunner).toHaveBeenCalledWith(`kyle-mac`)
    expect(manager.spawn).not.toHaveBeenCalled()
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

  it(`rejects explicit runner-target dispatch to a disabled runner`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
        getEntity: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `kyle-mac`,
          owner_user_id: `user-kyle`,
          admin_status: `disabled`,
        }),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(runnerPolicy),
      spawn: vi.fn(),
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest({ dispatch_policy: runnerPolicy })
    const res = createResponse()

    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(manager.spawn).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'content-type': `application/json`,
    })
    expect(jsonResponse(res)).toEqual({
      error: {
        code: `RUNNER_DISABLED`,
        message: `Runner is disabled`,
      },
    })
  })

  it(`allows explicit runner-target dispatch for the runner owner`, async () => {
    const entity = makeEntity(`/chat/test`, runnerPolicy)
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
        getEntity: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `kyle-mac`,
          owner_user_id: `user-kyle`,
          admin_status: `enabled`,
        }),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(runnerPolicy),
      spawn: vi.fn().mockResolvedValue({ ...entity, txid: 42 }),
    } as any
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      vi.fn().mockReturnValue({ userId: `user-kyle` })
    )
    const req = createRequest({
      dispatch_policy: runnerPolicy,
      args: { prompt: `ship it` },
    })
    const res = createResponse()

    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(manager.spawn).toHaveBeenCalledWith(`chat`, {
      instance_id: `test`,
      args: { prompt: `ship it` },
      tags: { created_by: `user-kyle` },
      parent: undefined,
      dispatch_policy: runnerPolicy,
      initialMessage: undefined,
      wake: undefined,
    })
    expect(res.setHeader).not.toHaveBeenCalledWith(
      `x-write-token`,
      entity.write_token
    )
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      'content-type': `application/json`,
    })
  })

  it(`does not require webhook/default-policy spawn authentication but stamps authenticated users`, async () => {
    const webhookPolicy = {
      targets: [{ type: `webhook`, url: `https://example.test/wake` }],
    } as const
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
        getEntity: vi.fn(),
        getRunner: vi.fn(),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(webhookPolicy),
      spawn: vi.fn().mockResolvedValue({
        ...makeEntity(`/chat/webhook`, webhookPolicy),
        txid: 7,
      }),
    } as any
    const authenticateRequest = vi.fn(() => ({ userId: `user-kyle` }))
    const routes = new ElectricAgentsRoutes(
      manager,
      undefined,
      authenticateRequest
    )
    const req = createRequest({})
    const res = createResponse()

    const handled = await routes.handleRequest(`PUT`, `/chat/webhook`, req, res)

    expect(handled).toBe(true)
    expect(authenticateRequest).toHaveBeenCalled()
    expect(manager.registry.getRunner).not.toHaveBeenCalled()
    expect(manager.spawn).toHaveBeenCalledWith(
      `chat`,
      expect.objectContaining({ tags: { created_by: `user-kyle` } })
    )
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      'content-type': `application/json`,
    })
  })
})

describe(`ElectricAgentsRoutes schedule endpoints`, () => {
  it(`routes future-send schedule upserts to the manager and returns txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      upsertFutureSendSchedule: vi
        .fn()
        .mockResolvedValue({ txid: `tx-future-123` }),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest({
      scheduleType: `future_send`,
      payload: { text: `hi` },
      fireAt: `2026-04-10T02:30:00.000Z`,
    })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `PUT`,
      `/chat/test/schedules/say_hi`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.upsertFutureSendSchedule).toHaveBeenCalledWith(
      `/chat/test`,
      {
        id: `say_hi`,
        payload: { text: `hi` },
        targetUrl: undefined,
        fireAt: `2026-04-10T02:30:00.000Z`,
        from: undefined,
        messageType: undefined,
      }
    )
    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'content-type': `application/json`,
    })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ txid: `tx-future-123` })
    )
  })

  it(`routes cron schedule upserts to the manager and returns txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      upsertCronSchedule: vi.fn().mockResolvedValue({ txid: `tx-cron-123` }),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest({
      scheduleType: `cron`,
      expression: `*/5 * * * *`,
      timezone: `America/Denver`,
      payload: `load xyz skills`,
      debounceMs: 1000,
    })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `PUT`,
      `/chat/test/schedules/heartbeat`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.upsertCronSchedule).toHaveBeenCalledWith(`/chat/test`, {
      id: `heartbeat`,
      expression: `*/5 * * * *`,
      timezone: `America/Denver`,
      payload: `load xyz skills`,
      debounceMs: 1000,
      timeoutMs: undefined,
    })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ txid: `tx-cron-123` })
    )
  })

  it(`rejects cron schedule upserts without payload`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      upsertCronSchedule: vi.fn(),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest({
      scheduleType: `cron`,
      expression: `*/5 * * * *`,
      timezone: `America/Denver`,
    })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `PUT`,
      `/chat/test/schedules/heartbeat`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.upsertCronSchedule).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'content-type': `application/json`,
    })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        error: {
          code: `INVALID_REQUEST`,
          message: `Missing required field: payload`,
        },
      })
    )
  })

  it(`routes schedule deletes to the manager and returns txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      deleteSchedule: vi.fn().mockResolvedValue({ txid: `tx-delete-123` }),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest()
    const res = createResponse()

    const handled = await routes.handleRequest(
      `DELETE`,
      `/chat/test/schedules/say_hi`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.deleteSchedule).toHaveBeenCalledWith(`/chat/test`, {
      id: `say_hi`,
    })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({ txid: `tx-delete-123` })
    )
  })
})

describe(`ElectricAgentsRoutes send endpoint`, () => {
  it(`returns validation errors from delayed sends before enqueueing`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      enqueueDelayedSend: vi
        .fn()
        .mockRejectedValue(
          new ElectricAgentsError(
            `INVALID_REQUEST`,
            `Missing required field: from`,
            400
          )
        ),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest({
      payload: { text: `hi` },
      afterMs: 60_000,
    })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/chat/test/send`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.enqueueDelayedSend).toHaveBeenCalledOnce()
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'content-type': `application/json`,
    })
    expect(res.end).toHaveBeenCalledWith(
      JSON.stringify({
        error: {
          code: `INVALID_REQUEST`,
          message: `Missing required field: from`,
        },
      })
    )
  })
})

describe(`ElectricAgentsRoutes fork endpoint`, () => {
  it(`routes fork requests to the manager and returns public entities`, async () => {
    const forkedRoot = {
      url: `/chat/root-copy`,
      type: `chat`,
      status: `idle`,
      streams: {
        main: `/chat/root-copy/main`,
        error: `/chat/root-copy/error`,
      },
      subscription_id: `chat-handler`,
      write_token: `secret-token`,
      tags: {},
      spawn_args: {},
      created_at: 1,
      updated_at: 1,
    }
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/root` }),
        getEntityType: vi.fn(),
      },
      forkSubtree: vi.fn().mockResolvedValue({
        root: forkedRoot,
        entities: [forkedRoot],
      }),
    } as any

    const routes = new ElectricAgentsRoutes(manager)
    const req = createRequest({ waitTimeoutMs: 5000 })
    const res = createResponse()

    const handled = await routes.handleRequest(
      `POST`,
      `/chat/root/fork`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.forkSubtree).toHaveBeenCalledWith(`/chat/root`, {
      rootInstanceId: undefined,
      waitTimeoutMs: 5000,
    })
    expect(res.writeHead).toHaveBeenCalledWith(201, {
      'content-type': `application/json`,
    })
    const payload = JSON.parse(res.end.mock.calls[0]![0]) as {
      root: Record<string, unknown>
    }
    expect(payload.root).toMatchObject({
      url: `/chat/root-copy`,
      type: `chat`,
      status: `idle`,
    })
    expect(payload.root).not.toHaveProperty(`write_token`)
    expect(payload.root).not.toHaveProperty(`subscription_id`)
  })
})

describe(`ElectricAgentsRoutes authenticated user stamping`, () => {
  it(`stamps spawn tags.created_by from the authenticated user`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(undefined),
      spawn: vi.fn().mockImplementation((_type, opts) =>
        Promise.resolve(
          makeEntity(`/chat/test`, undefined) && {
            ...makeEntity(`/chat/test`),
            tags: opts.tags,
            txid: 1,
          }
        )
      ),
    } as any
    const routes = new ElectricAgentsRoutes(manager, {
      authenticateRequest: () => ({
        userId: `alice-id`,
        email: `alice@example.com`,
        name: `Alice`,
      }),
    })

    const req = createRequest({ tags: { created_by: `Mallory <m@x>`, x: `y` } })
    const res = createResponse()
    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(manager.spawn).toHaveBeenCalledWith(
      `chat`,
      expect.objectContaining({
        tags: { created_by: `Alice <alice@example.com>`, x: `y` },
      })
    )
  })

  it(`strips spoofed spawn tags.created_by when auth is configured but no user is authenticated`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
      },
      resolveEffectiveDispatchPolicy: vi.fn().mockResolvedValue(undefined),
      spawn: vi.fn().mockImplementation((_type, opts) =>
        Promise.resolve({
          ...makeEntity(`/chat/test`),
          tags: opts.tags,
          txid: 1,
        })
      ),
    } as any
    const authenticateRequest = vi.fn().mockReturnValue(null)
    const routes = new ElectricAgentsRoutes(manager, { authenticateRequest })

    const req = createRequest({ tags: { created_by: `Mallory <m@x>`, x: `y` } })
    const res = createResponse()
    const handled = await routes.handleRequest(`PUT`, `/chat/test`, req, res)

    expect(handled).toBe(true)
    expect(authenticateRequest).toHaveBeenCalledWith(req)
    expect(manager.spawn).toHaveBeenCalledWith(
      `chat`,
      expect.objectContaining({ tags: { x: `y` } })
    )
  })

  it(`overrides spoofed send from with the authenticated user`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      send: vi.fn().mockResolvedValue(undefined),
    } as any
    const routes = new ElectricAgentsRoutes(manager, {
      authenticateRequest: () => ({
        userId: `alice-id`,
        email: `alice@example.com`,
        name: `Alice`,
      }),
    })

    const req = createRequest({
      from: `Mallory <m@x>`,
      payload: { text: `hi` },
    })
    const res = createResponse()
    const handled = await routes.handleRequest(
      `POST`,
      `/chat/test/send`,
      req,
      res
    )

    expect(handled).toBe(true)
    expect(manager.send).toHaveBeenCalledWith(
      `/chat/test`,
      expect.objectContaining({ from: `Alice <alice@example.com>` })
    )
    expect(res.writeHead).toHaveBeenCalledWith(204)
  })
})
