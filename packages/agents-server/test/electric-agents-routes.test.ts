import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/electric-agents-manager'
import { ElectricAgentsRoutes } from '../src/electric-agents-routes'

function createRequest(body?: unknown) {
  const req = new EventEmitter() as EventEmitter & {
    headers: Record<string, string>
  }
  req.headers = {}

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
