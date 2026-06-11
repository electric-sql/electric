import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/entity-manager'
import { globalRouter } from '../src/routing/global-router'
import type { TenantContext } from '../src/routing/context'
import type { DurableStreamsRoutingAdapter } from '../src/routing/durable-streams-routing-adapter'

function createRequest(
  method: string,
  path: string,
  body?: unknown,
  rawBody = false,
  headers?: HeadersInit
): Request {
  const init: RequestInit = { method, headers }
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
  rawBody = false,
  principal = {
    kind: `system`,
    id: `dev-local`,
    key: `system:dev-local`,
    url: `/principal/system:dev-local`,
  },
  headers?: HeadersInit
): Promise<Response> {
  const result = await globalRouter.fetch(
    createRequest(method, path, body, rawBody, headers),
    {
      service: `test`,
      entityManager: manager,
      isShuttingDown: () => false,
      principal,
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

function fakeDeleteDb() {
  const where = vi.fn().mockResolvedValue(undefined)
  const delete_ = vi.fn(() => ({ where }))
  return {
    db: { delete: delete_ },
    delete: delete_,
    where,
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

const testJwk = {
  kty: `OKP` as const,
  crv: `Ed25519` as const,
  x: `test-public-key`,
  kid: `ds_test`,
  use: `sig` as const,
  alg: `EdDSA` as const,
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

describe(`ElectricAgentsRoutes attachment endpoints`, () => {
  it(`serves attachments with non-ASCII filenames without throwing`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      readAttachment: vi.fn().mockResolvedValue({
        attachment: {
          mimeType: `image/png`,
          filename: `Screenshot 2026-06-09 at 12.09.29 PM.png`,
        },
        bytes: new Uint8Array([1, 2, 3]),
      }),
    } as any

    const response = await routeResponse(
      manager,
      `GET`,
      `/_electric/entities/chat/test/attachments/att-1`
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(`content-disposition`)).toBe(
      `attachment; filename="Screenshot 2026-06-09 at 12.09.29_PM.png"; filename*=UTF-8''Screenshot%202026-06-09%20at%2012.09.29%E2%80%AFPM.png`
    )
    await expect(response.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer
    )
  })
})

describe(`ElectricAgentsRoutes cron stream ensure endpoint`, () => {
  it(`rejects cron ensure requests without an expression in the schema layer`, async () => {
    const manager = {
      getOrCreateCronStream: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/observations/cron/ensure-stream`,
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
          principal: {
            kind: `system`,
            id: `dev-local`,
            key: `system:dev-local`,
            url: `/principal/system:dev-local`,
          },
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

  it(`serves the agents-server webhook signing JWKS at the stream root`, async () => {
    const webhookSigner = {
      sign: vi.fn(),
      jwks: vi.fn(() => ({ keys: [testJwk] })),
    }

    const result = await globalRouter.fetch(
      createRequest(`GET`, `/__ds/jwks.json`),
      {
        service: `tenant-a`,
        publicUrl: `http://agents.local`,
        durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
        webhookSigner,
        isShuttingDown: () => false,
      } as unknown as TenantContext
    )

    expect(result.status).toBe(200)
    expect(result.headers.get(`content-type`)).toBe(`application/jwk-set+json`)
    expect(result.headers.get(`cache-control`)).toBe(`public, max-age=300`)
    await expect(result.json()).resolves.toEqual({ keys: [testJwk] })
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
          publicUrl: `http://agents.local/t/tenant-a/v1`,
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
          url: `http://agents.local/t/tenant-a/v1/_electric/subscription-webhooks/horton-handler`,
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

  it(`rewrites subscription webhook signing metadata to the agents-server JWKS`, async () => {
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: `horton-handler`,
          subscription_id: `horton-handler`,
          type: `webhook`,
          webhook: {
            url: `http://agents.local/_electric/subscription-webhooks/horton-handler`,
            signing: {
              alg: `ed25519`,
              kid: `ds_durable`,
              jwks_url: `http://durable.local/v1/stream/__ds/jwks.json`,
            },
          },
        }),
        { status: 201, headers: { 'content-type': `application/json` } }
      )
    )
    const db = fakeInsertDb()
    const webhookSigner = {
      sign: vi.fn(),
      jwks: vi.fn(() => ({ keys: [testJwk] })),
    }

    try {
      const result = await globalRouter.fetch(
        createRequest(`PUT`, `/__ds/subscriptions/horton-handler`, {
          type: `webhook`,
          pattern: `horton/**`,
          webhook: { url: `http://localhost:4448/runtime-webhook` },
        }),
        {
          service: `tenant-a`,
          publicUrl: `http://agents.local/t/tenant-a/v1`,
          durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
          webhookSigner,
          pgDb: db.db,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(201)
      await expect(result.json()).resolves.toMatchObject({
        webhook: {
          signing: {
            alg: `ed25519`,
            kid: `ds_test`,
            jwks_url: `http://agents.local/t/tenant-a/v1/__ds/jwks.json`,
          },
        },
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`forwards successful subscription deletes as bodyless 204 responses`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 204 }))
    const db = fakeDeleteDb()

    try {
      const result = await globalRouter.fetch(
        createRequest(`DELETE`, `/__ds/subscriptions/horton-handler`),
        {
          service: `tenant-a`,
          durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
          pgDb: db.db,
          isShuttingDown: () => false,
        } as unknown as TenantContext
      )

      expect(result.status).toBe(204)
      await expect(result.text()).resolves.toBe(``)
      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(db.delete).toHaveBeenCalledOnce()
      expect(db.where).toHaveBeenCalledOnce()
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

  it(`rejects spoofed from_agent values`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/test`,
          created_by: `/principal/agent%3Achat%2Ftest`,
        }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ txid: `tx-send` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/send`,
      {
        payload: { text: `hi` },
        from_agent: `/chat/other`,
      },
      false,
      {
        kind: `agent`,
        id: `chat/test`,
        key: `agent:chat/test`,
        url: `/principal/agent%3Achat%2Ftest`,
      }
    )

    expect(manager.send).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toEqual({
      error: {
        code: `INVALID_REQUEST`,
        message: `Request from_agent must match authenticated agent principal`,
      },
    })
  })

  it(`allows from_agent values with a valid active agent write token`, async () => {
    const targetEntity = { url: `/chat/test` }
    const agentEntity = { url: `/horton/current`, write_token: `entity-token` }
    const manager = {
      registry: {
        getEntity: vi.fn(async (url: string) => {
          if (url === `/chat/test`) return targetEntity
          if (url === `/horton/current`) return agentEntity
          return null
        }),
        getEntityType: vi.fn(),
      },
      isValidWriteToken: vi.fn(
        (entity, token) => entity === agentEntity && token === `claim-token`
      ),
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ txid: `tx-send` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/send`,
      {
        payload: { text: `hi` },
        from_principal: `/principal/system:dev-local`,
        from_agent: `/horton/current`,
      },
      false,
      {
        kind: `system`,
        id: `dev-local`,
        key: `system:dev-local`,
        url: `/principal/system:dev-local`,
      },
      { 'electric-claim-token': `claim-token` }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ txid: `tx-send` })
    expect(manager.isValidWriteToken).toHaveBeenCalledWith(
      agentEntity,
      `claim-token`
    )
    expect(manager.send).toHaveBeenCalledWith(`/chat/test`, {
      from: `/principal/system:dev-local`,
      from_principal: `/principal/system:dev-local`,
      from_agent: `/horton/current`,
      payload: { text: `hi` },
      key: undefined,
      type: undefined,
      mode: undefined,
      position: undefined,
    })
  })

  it(`allows matching from_agent values for agent principals`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/test`,
          created_by: `/principal/agent%3Achat%2Ftest`,
        }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ txid: `tx-send` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/send`,
      {
        payload: { text: `hi` },
        from_agent: `/chat/test`,
      },
      false,
      {
        kind: `agent`,
        id: `chat/test`,
        key: `agent:chat/test`,
        url: `/principal/agent%3Achat%2Ftest`,
      }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ txid: `tx-send` })
    expect(manager.send).toHaveBeenCalledWith(`/chat/test`, {
      from: `/principal/agent%3Achat%2Ftest`,
      from_principal: `/principal/agent%3Achat%2Ftest`,
      from_agent: `/chat/test`,
      payload: { text: `hi` },
      key: undefined,
      type: undefined,
      mode: undefined,
      position: undefined,
    })
  })

  it(`rejects mismatched from_principal values`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      send: vi.fn().mockResolvedValue({ txid: `tx-send` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/send`,
      {
        payload: { text: `hi` },
        from_principal: `/principal/user%3Aother`,
      }
    )

    expect(manager.send).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    expect(await responseJson(response)).toEqual({
      error: {
        code: `INVALID_REQUEST`,
        message: `Request from_principal must match Electric-Principal`,
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

describe(`ElectricAgentsRoutes tag endpoints`, () => {
  const existingEntity = {
    url: `/chat/test`,
    type: `chat`,
    status: `running`,
    streams: { main: `/chat/test/main` },
    tags: {},
    created_at: 1,
    updated_at: 1,
  }

  it(`routes tag upserts to the manager and returns public entity data with txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue(existingEntity),
        getEntityType: vi.fn(),
      },
      setTag: vi.fn().mockResolvedValue({
        ...existingEntity,
        tags: { title: `Editable title` },
        write_token: `secret-token`,
        subscription_id: `internal-subscription`,
        txid: 12345,
      }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/tags/title`,
      { value: `Editable title` },
      false,
      undefined,
      { Authorization: `Bearer write-token` }
    )

    expect(manager.setTag).toHaveBeenCalledWith(`/chat/test`, `title`, {
      value: `Editable title`,
    })
    expect(await responseJson(response)).toEqual({
      url: `/chat/test`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/test/main` },
      dispatch_policy: undefined,
      tags: { title: `Editable title` },
      spawn_args: undefined,
      sandbox: undefined,
      parent: undefined,
      created_by: undefined,
      created_at: 1,
      updated_at: 1,
      txid: 12345,
    })
  })

  it(`routes principal-authorized tag upserts without requiring legacy entity write tokens`, async () => {
    const principal = {
      kind: `user`,
      id: `alice`,
      key: `user:alice`,
      url: `/principal/user:alice`,
    }
    const principalOwnedEntity = {
      ...existingEntity,
      created_by: principal.url,
    }
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue(principalOwnedEntity),
        getEntityType: vi.fn(),
      },
      setTag: vi.fn().mockResolvedValue({
        ...principalOwnedEntity,
        tags: { title: `Editable title` },
        txid: 12345,
      }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/tags/title`,
      { value: `Editable title` },
      false,
      principal
    )

    expect(response.status).toBe(200)
    expect(manager.setTag).toHaveBeenCalledWith(`/chat/test`, `title`, {
      value: `Editable title`,
    })
  })

  it(`routes tag deletes to the manager and returns public entity data with txid`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue(existingEntity),
        getEntityType: vi.fn(),
      },
      deleteTag: vi.fn().mockResolvedValue({
        ...existingEntity,
        tags: {},
        txid: 12346,
      }),
    } as any

    const response = await routeResponse(
      manager,
      `DELETE`,
      `/_electric/entities/chat/test/tags/title`,
      undefined,
      false,
      undefined,
      { Authorization: `Bearer write-token` }
    )

    expect(manager.deleteTag).toHaveBeenCalledWith(`/chat/test`, `title`)
    expect(await responseJson(response)).toMatchObject({
      url: `/chat/test`,
      tags: {},
      txid: 12346,
    })
  })
})

describe(`ElectricAgentsRoutes signal endpoint`, () => {
  it(`routes valid signals to the manager and returns the signal response`, async () => {
    const signalResponse = {
      url: `/chat/test`,
      signal: `SIGINT`,
      previous_state: `running`,
      new_state: `running`,
      created_at: 1_760_000_000_000,
      txid: 123,
    }
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/test`,
          streams: { main: `/chat/test/main` },
        }),
        getEntityType: vi.fn(),
      },
      signal: vi.fn().mockResolvedValue(signalResponse),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/signal`,
      {
        signal: `SIGINT`,
        reason: `Stop from UI`,
        payload: { source: `test` },
      }
    )

    expect(manager.signal).toHaveBeenCalledWith(`/chat/test`, {
      signal: `SIGINT`,
      reason: `Stop from UI`,
      payload: { source: `test` },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(signalResponse)
  })

  it(`rejects unknown signals before calling the manager`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/test`,
          streams: { main: `/chat/test/main` },
        }),
        getEntityType: vi.fn(),
      },
      signal: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/signal`,
      { signal: `NOPE` }
    )

    expect(manager.signal).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.code).toBe(`INVALID_REQUEST`)
    expect(body.error.message).toBe(`Request body does not match API schema`)
  })

  it(`rejects principal entity signals before calling the manager`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/principal/user%3Aalice%40example.com`,
          type: `principal`,
          streams: {
            main: `/principal/user%3Aalice%40example.com/main`,
          },
        }),
        getEntityType: vi.fn(),
      },
      signal: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/principal/user%3Aalice%40example.com/signal`,
      { signal: `SIGKILL` }
    )

    expect(manager.signal).not.toHaveBeenCalled()
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toEqual({
      code: `INVALID_REQUEST`,
      message: `Principal entities are built in and cannot be signaled`,
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
      createdBy: `/principal/system:dev-local`,
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

  it(`forwards anchor, parent, wake, initialMessage, and tags through to forkSubtree (and sends the initial message)`, async () => {
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
      tags: { experiment: `ecosystem-maturity` },
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
      send: vi.fn().mockResolvedValue({ txid: `tx-send` }),
    } as any

    const wake = {
      subscriberUrl: `/chat/parent`,
      condition: `runFinished` as const,
      includeResponse: true,
    }

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        anchor: `latest_completed_run`,
        parent: `/chat/parent`,
        wake,
        initialMessage: { text: `hello fork` },
        tags: { experiment: `ecosystem-maturity` },
      }
    )

    expect(response.status).toBe(201)
    expect(manager.forkSubtree).toHaveBeenCalledWith(`/chat/root`, {
      rootInstanceId: undefined,
      waitTimeoutMs: undefined,
      anchor: `latest_completed_run`,
      parent: `/chat/parent`,
      wake,
      tags: { experiment: `ecosystem-maturity` },
      createdBy: `/principal/system:dev-local`,
    })
    // initialMessage is NOT passed into forkSubtree — it's delivered
    // via entityManager.send after linkEntityDispatchSubscription, the
    // same ordering spawn uses. Verify the send happened against the
    // new root fork with the parent as `from`.
    expect(manager.send).toHaveBeenCalledWith(`/chat/root-copy`, {
      from: `/chat/parent`,
      payload: { text: `hello fork` },
    })
  })

  it(`rejects when fork_pointer and anchor are both present`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/root` }),
        getEntityType: vi.fn(),
      },
      forkSubtree: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        anchor: `latest_completed_run`,
        fork_pointer: { offset: `abc`, sub_offset: 1 },
      }
    )

    expect(response.status).toBe(400)
    expect(manager.forkSubtree).not.toHaveBeenCalled()
  })

  it(`rejects when parent is set but does not exist`, async () => {
    // getEntity returns the source for the source-route lookup but
    // null for the parent lookup. Differentiate by URL.
    const getEntity = vi.fn(async (url: string) =>
      url === `/chat/root` ? { url: `/chat/root` } : null
    )
    const manager = {
      registry: { getEntity, getEntityType: vi.fn() },
      forkSubtree: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        anchor: `latest_completed_run`,
        parent: `/chat/missing-parent`,
      }
    )

    expect(response.status).toBe(404)
    expect(manager.forkSubtree).not.toHaveBeenCalled()
  })

  it(`rejects when wake is set without parent`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/root` }),
        getEntityType: vi.fn(),
      },
      forkSubtree: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        anchor: `latest_completed_run`,
        wake: {
          subscriberUrl: `/chat/stranger`,
          condition: `runFinished`,
          includeResponse: true,
        },
      }
    )

    expect(response.status).toBe(400)
    expect(manager.forkSubtree).not.toHaveBeenCalled()
  })

  it(`rejects when wake.subscriberUrl does not match parent`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/root` }),
        getEntityType: vi.fn(),
      },
      forkSubtree: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/root/fork`,
      {
        anchor: `latest_completed_run`,
        parent: `/chat/parent`,
        wake: {
          subscriberUrl: `/chat/stranger`,
          condition: `runFinished`,
          includeResponse: true,
        },
      }
    )

    expect(response.status).toBe(401)
    expect(manager.forkSubtree).not.toHaveBeenCalled()
  })
})

describe(`ElectricAgentsRoutes collections endpoint`, () => {
  it(`routes a collection write to the manager with the authenticated principal`, async () => {
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({ url: `/chat/test` }),
        getEntityType: vi.fn(),
      },
      ensurePrincipal: vi.fn().mockResolvedValue(undefined),
      writeCollection: vi.fn().mockResolvedValue({ key: `c1` }),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entities/chat/test/collections/comments`,
      { operation: `insert`, key: `c1`, value: { body: `hi` } }
    )

    expect(response.status).toBe(201)
    expect(await responseJson(response)).toEqual({ key: `c1` })
    expect(manager.writeCollection).toHaveBeenCalledWith(
      `/chat/test`,
      `comments`,
      expect.objectContaining({
        operation: `insert`,
        key: `c1`,
        value: { body: `hi` },
        principal: expect.objectContaining({ url: expect.any(String) }),
      })
    )
  })
})

describe(`ElectricAgentsRoutes entity-type registration`, () => {
  it(`persists externally_writable_collections on entity type registration`, async () => {
    const registerEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      description: `chat`,
      revision: 1,
      created_at: `t`,
      updated_at: `t`,
      externally_writable_collections: {
        comments: { type: `state:comments`, contract: `comments/v1` },
      },
    })
    const manager = {
      registry: { getEntityType: vi.fn() },
      registerEntityType,
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entity-types`,
      {
        name: `chat`,
        description: `chat`,
        externally_writable_collections: {
          comments: { type: `state:comments`, contract: `comments/v1` },
        },
      }
    )

    expect(response.status).toBe(201)
    expect(registerEntityType).toHaveBeenCalledWith(
      expect.objectContaining({
        externally_writable_collections: {
          comments: { type: `state:comments`, contract: `comments/v1` },
        },
      })
    )
  })

  it(`rejects a writable "comments" collection without the canonical contract`, async () => {
    const manager = {
      registry: { getEntityType: vi.fn() },
      registerEntityType: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entity-types`,
      {
        name: `chat`,
        description: `chat`,
        externally_writable_collections: {
          comments: { type: `state:comments` },
        },
      }
    )

    expect(response.status).toBe(400)
    expect(manager.registerEntityType).not.toHaveBeenCalled()
  })

  it(`rejects the comments contract registered under another collection name`, async () => {
    const manager = {
      registry: { getEntityType: vi.fn() },
      registerEntityType: vi.fn(),
    } as any

    const response = await routeResponse(
      manager,
      `POST`,
      `/_electric/entity-types`,
      {
        name: `chat`,
        description: `chat`,
        externally_writable_collections: {
          feedback: { type: `state:feedback`, contract: `comments/v1` },
        },
      }
    )

    expect(response.status).toBe(400)
    expect(manager.registerEntityType).not.toHaveBeenCalled()
  })
})
