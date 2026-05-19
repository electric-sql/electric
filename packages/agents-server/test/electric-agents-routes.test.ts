import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/entity-manager'
import { globalRouter } from '../src/routing/global-router'
import type { TenantContext } from '../src/routing/context'
import type { DurableStreamsRoutingAdapter } from '../src/routing/durable-streams-routing-adapter'

function createRequest(
  method: string,
  path: string,
  body?: unknown,
  rawBody = false
): Request {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = rawBody ? String(body) : JSON.stringify(body)
  }
  return new Request(`http://localhost${path}`, init)
}

async function routeResponse(
  manager: unknown,
  method: string,
  path: string,
  body?: unknown,
  rawBody = false
): Promise<Response> {
  const result = await globalRouter.fetch(
    createRequest(method, path, body, rawBody),
    {
      service: `test`,
      entityManager: manager,
      isShuttingDown: () => false,
      principal: {
        kind: `system`,
        id: `dev-local`,
        key: `system:dev-local`,
        url: `/principal/system:dev-local`,
      },
    } as unknown as TenantContext
  )
  expect(result).toBeInstanceOf(Response)
  return result as Response
}

async function responseJson(response: Response): Promise<any> {
  return await response.json()
}

function requestBodyText(body: BodyInit | null | undefined): string {
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body))
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body as Uint8Array)
  }
  return String(body ?? ``)
}

function fakeInsertDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  return {
    db: { insert },
    insert,
    values,
    onConflictDoUpdate,
  }
}

const serviceRoutedTestAdapter: DurableStreamsRoutingAdapter = {
  streamUrl(input) {
    const incomingUrl = new URL(input.requestUrl, `http://localhost`)
    const path = incomingUrl.pathname.replace(/^\/+/, ``)
    const target = new URL(
      `/v1/streams/${input.serviceId}/${path}`,
      input.durableStreamsUrl
    )
    target.search = incomingUrl.search
    return target
  },
  controlUrl(input) {
    const incomingUrl = new URL(input.requestUrl, `http://localhost`)
    const target = new URL(
      `/v1/streams/${input.serviceId}${incomingUrl.pathname}`,
      input.durableStreamsUrl
    )
    target.search = incomingUrl.search
    return target
  },
  toBackendStreamPath(_serviceId, streamPath) {
    return streamPath.replace(/^\/+/, ``)
  },
  toRuntimeStreamPath(_serviceId, streamPath) {
    return streamPath.replace(/^\/+/, ``)
  },
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

    const response = await routeResponse(
      manager,
      `PUT`,
      `/_electric/entities/chat/test/schedules/say_hi`,
      {
        scheduleType: `future_send`,
        payload: { text: `hi` },
        fireAt: `2026-04-10T02:30:00.000Z`,
      }
    )

    expect(manager.upsertFutureSendSchedule).toHaveBeenCalledWith(
      `/chat/test`,
      {
        id: `say_hi`,
        payload: { text: `hi` },
        targetUrl: undefined,
        fireAt: `2026-04-10T02:30:00.000Z`,
        senderUrl: `/principal/system:dev-local`,
        messageType: undefined,
      }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get(`content-type`)).toContain(`application/json`)
    expect(await responseJson(response)).toEqual({ txid: `tx-future-123` })
  })

  it(`routes cron schedule upserts to the manager and returns txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      upsertCronSchedule: vi.fn().mockResolvedValue({ txid: `tx-cron-123` }),
    } as any

    const response = await routeResponse(
      manager,
      `PUT`,
      `/_electric/entities/chat/test/schedules/heartbeat`,
      {
        scheduleType: `cron`,
        expression: `*/5 * * * *`,
        timezone: `America/Denver`,
        payload: `load xyz skills`,
        debounceMs: 1000,
      }
    )

    expect(manager.upsertCronSchedule).toHaveBeenCalledWith(`/chat/test`, {
      id: `heartbeat`,
      expression: `*/5 * * * *`,
      timezone: `America/Denver`,
      payload: `load xyz skills`,
      debounceMs: 1000,
      timeoutMs: undefined,
    })
    expect(await responseJson(response)).toEqual({ txid: `tx-cron-123` })
  })

  it(`rejects cron schedule upserts without payload`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      upsertCronSchedule: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `PUT`,
      `/_electric/entities/chat/test/schedules/heartbeat`,
      {
        scheduleType: `cron`,
        expression: `*/5 * * * *`,
        timezone: `America/Denver`,
      }
    )

    expect(manager.upsertCronSchedule).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: `INVALID_REQUEST`,
        message: `Request body does not match API schema`,
        details: expect.arrayContaining([
          {
            path: `/`,
            message: `must have required property 'payload'`,
          },
        ]),
      },
    })
  })

  it(`routes schedule deletes to the manager and returns txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      deleteSchedule: vi.fn().mockResolvedValue({ txid: `tx-delete-123` }),
    } as any

    const response = await routeResponse(
      manager,
      `DELETE`,
      `/_electric/entities/chat/test/schedules/say_hi`
    )

    expect(manager.deleteSchedule).toHaveBeenCalledWith(`/chat/test`, {
      id: `say_hi`,
    })
    expect(await responseJson(response)).toEqual({ txid: `tx-delete-123` })
  })
})

describe(`ElectricAgentsRoutes cron registration endpoint`, () => {
  it(`rejects cron registrations without an expression in the schema layer`, async () => {
    const manager = {
      getOrCreateCronStream: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/cron/register`,
      {}
    )

    expect(manager.getOrCreateCronStream).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: `INVALID_REQUEST`,
        message: `Request body does not match API schema`,
        details: expect.arrayContaining([
          {
            path: `/`,
            message: `must have required property 'expression'`,
          },
        ]),
      },
    })
  })
})

describe(`ElectricAgentsRoutes shared-state streams`, () => {
  it(`routes shared-state stream traffic through durable streams`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 201 }))

    try {
      const result = await globalRouter.fetch(
        createRequest(`PUT`, `/_electric/shared-state/board-1`),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/custom/ds-prefix`,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(201)
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/custom/ds-prefix/_electric/shared-state/board-1`
      )
      expect(init).toMatchObject({ method: `PUT` })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`routes subscription control-plane traffic through durable streams`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 202 }))

    try {
      const result = await globalRouter.fetch(
        createRequest(`GET`, `/__ds/subscriptions/sub-1`),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/custom/ds-prefix`,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(202)
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/custom/ds-prefix/__ds/subscriptions/sub-1`
      )
      expect(init).toMatchObject({ method: `GET` })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`reserves __ds control paths before normal stream operations`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 404 }))

    try {
      const result = await globalRouter.fetch(
        createRequest(`POST`, `/__ds/unknown-control-route`),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/v1/stream/test`,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(404)
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/v1/stream/test/__ds/unknown-control-route`
      )
      expect(init).toMatchObject({ method: `POST` })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`treats prefixed __ds paths as normal stream paths`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 204 }))
    const endRead = vi.fn()
    const beginClientRead = vi.fn().mockResolvedValue(endRead)

    try {
      const result = await globalRouter.fetch(
        createRequest(`GET`, `/v1/stream/__ds/subscriptions/sub-1`),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/v1/stream/test`,
          entityBridgeManager: {
            beginClientRead,
            touchByStreamPath: vi.fn(),
          },
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(204)
      expect(fetchSpy).toHaveBeenCalledOnce()
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/v1/stream/test/v1/stream/__ds/subscriptions/sub-1`
      )
      expect(init).toMatchObject({ method: `GET` })
      expect(beginClientRead).toHaveBeenCalledWith(
        `/v1/stream/__ds/subscriptions/sub-1`
      )
      expect(endRead).toHaveBeenCalledOnce()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`uses configured durable streams bearer auth for service-scoped subscription traffic`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 202 }))

    try {
      const result = await globalRouter.fetch(
        new Request(`http://localhost/__ds/subscriptions/sub-1`, {
          method: `GET`,
          headers: { authorization: `Bearer caller-token` },
        }),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/v1/stream/test`,
          durableStreamsBearer: `service-token`,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(202)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(new Headers(init?.headers).get(`authorization`)).toBe(
        `Bearer service-token`
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`preserves subscription-scoped bearer auth for ack proxy traffic`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })))

    try {
      const result = await globalRouter.fetch(
        new Request(`http://localhost/__ds/subscriptions/sub-1/ack`, {
          method: `POST`,
          headers: {
            authorization: `Bearer claim-token`,
            'content-type': `application/json`,
          },
          body: JSON.stringify({ wake_id: `wake-1`, generation: 1 }),
        }),
        {
          service: `test`,
          durableStreamsUrl: `http://durable.local/v1/stream/test`,
          durableStreamsBearer: `service-token`,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(200)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(new Headers(init?.headers).get(`authorization`)).toBe(
        `Bearer claim-token`
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`rewrites webhook subscription targets and keeps the original target locally`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 201 }))
    const db = fakeInsertDb()

    try {
      const result = await globalRouter.fetch(
        createRequest(`PUT`, `/__ds/subscriptions/horton-handler`, {
          type: `webhook`,
          pattern: `horton/**`,
          webhook: { url: `http://localhost:4448/runtime-webhook` },
        }),
        {
          service: `tenant-a`,
          publicUrl: `http://agents.local`,
          durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
          pgDb: db.db,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(201)
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler`
      )
      expect(JSON.parse(requestBodyText(init?.body))).toEqual({
        type: `webhook`,
        pattern: `horton/**`,
        webhook: {
          url: `http://agents.local/_electric/webhook-forward/horton-handler`,
        },
      })
      expect(db.values).toHaveBeenCalledWith({
        tenantId: `tenant-a`,
        subscriptionId: `horton-handler`,
        webhookUrl: `http://localhost:4448/runtime-webhook`,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`lets a routing adapter own service-routed subscription URLs and stream names`, async () => {
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: `horton-handler`,
          pattern: `horton/**`,
          streams: [
            {
              path: `horton/demo/main`,
              link_type: `explicit`,
              acked_offset: `0`,
            },
          ],
        }),
        { status: 201, headers: { 'content-type': `application/json` } }
      )
    )
    const db = fakeInsertDb()

    try {
      const result = await globalRouter.fetch(
        createRequest(`PUT`, `/__ds/subscriptions/horton-handler`, {
          type: `webhook`,
          pattern: `horton/**`,
          streams: [`horton/demo/main`],
          webhook: { url: `http://localhost:4448/runtime-webhook` },
        }),
        {
          service: `tenant-a`,
          publicUrl: `http://agents.local`,
          durableStreamsUrl: `http://durable.local`,
          durableStreamsRouting: serviceRoutedTestAdapter,
          pgDb: db.db,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(201)
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/v1/streams/tenant-a/__ds/subscriptions/horton-handler`
      )
      expect(JSON.parse(requestBodyText(init?.body))).toMatchObject({
        pattern: `horton/**`,
        streams: [`horton/demo/main`],
      })
      await expect(result.json()).resolves.toMatchObject({
        pattern: `horton/**`,
        streams: [{ path: `horton/demo/main` }],
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`keeps subscription stream paths relative to the resolved stream root`, async () => {
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: `horton-handler`,
          pattern: `horton/**`,
          streams: [
            {
              path: `horton/demo/main`,
              link_type: `explicit`,
              acked_offset: `0`,
            },
          ],
        }),
        { status: 201, headers: { 'content-type': `application/json` } }
      )
    )
    const db = fakeInsertDb()

    try {
      const result = await globalRouter.fetch(
        createRequest(`PUT`, `/__ds/subscriptions/horton-handler`, {
          type: `webhook`,
          pattern: `horton/**`,
          streams: [`horton/demo/main`, `horton/existing/main`],
          webhook: { url: `http://localhost:4448/runtime-webhook` },
        }),
        {
          service: `tenant-a`,
          publicUrl: `http://agents.local`,
          durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
          pgDb: db.db,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(201)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(JSON.parse(requestBodyText(init?.body))).toMatchObject({
        pattern: `horton/**`,
        streams: [`horton/demo/main`, `horton/existing/main`],
      })
      await expect(result.json()).resolves.toMatchObject({
        pattern: `horton/**`,
        streams: [{ path: `horton/demo/main` }],
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe(`ElectricAgentsRoutes send endpoint`, () => {
  it(`returns a 404 from existing-entity middleware before sending`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue(null),
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
      },
      send: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/missing/send`,
      {
        payload: { text: `hi` },
      }
    )

    expect(manager.send).not.toHaveBeenCalled()
    expect(response.status).toBe(404)
    expect(await responseJson(response)).toEqual({
      error: {
        code: `NOT_FOUND`,
        message: `Entity not found at /chat/missing`,
      },
    })
  })

  it(`returns validation errors from delayed sends before enqueueing`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
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

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/send`,
      {
        payload: { text: `hi` },
        afterMs: 60_000,
      }
    )

    expect(manager.enqueueDelayedSend).toHaveBeenCalledOnce()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toEqual({
      error: {
        code: `INVALID_REQUEST`,
        message: `Missing required field: from`,
      },
    })
  })
})

describe(`ElectricAgentsRoutes spawn endpoint request validation`, () => {
  it(`rejects malformed JSON before spawning`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
      },
      spawn: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `PUT`,
      `/_electric/entities/chat/test`,
      `{`,
      true
    )

    expect(manager.spawn).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toEqual({
      error: {
        code: `INVALID_REQUEST`,
        message: `Invalid JSON body`,
      },
    })
  })

  it(`rejects schema-invalid spawn bodies before spawning`, async () => {
    const manager = {
      registry: {
        getEntityType: vi.fn().mockResolvedValue({ name: `chat` }),
      },
      spawn: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `PUT`,
      `/_electric/entities/chat/test`,
      {
        tags: { priority: 7 },
      }
    )

    expect(manager.spawn).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toMatchObject({
      error: {
        code: `INVALID_REQUEST`,
        message: `Request body does not match API schema`,
      },
    })
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

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        waitTimeoutMs: 5000,
      }
    )

    expect(manager.forkSubtree).toHaveBeenCalledWith(`/chat/root`, {
      rootInstanceId: undefined,
      waitTimeoutMs: 5000,
    })
    expect(response.status).toBe(201)
    expect(response.headers.get(`content-type`)).toContain(`application/json`)
    const payload = (await responseJson(response)) as {
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
