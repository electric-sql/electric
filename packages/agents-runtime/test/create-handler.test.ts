import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRuntimeHandler,
  createRuntimeRouter,
} from '../src/create-handler'
import { clearRegistry, defineEntity } from '../src/define-entity'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec'

const { processWebhookWakeMock } = vi.hoisted(() => ({
  processWebhookWakeMock: vi.fn(),
}))

vi.mock(`../src/process-wake`, () => ({
  processWebhookWake: processWebhookWakeMock,
  processWake: processWebhookWakeMock,
}))

function makeStandardSchema(
  jsonSchema: Record<string, unknown>
): StandardSchemaV1 & StandardJSONSchemaV1 {
  return {
    '~standard': {
      version: 1,
      vendor: `test`,
      validate: (value: unknown) => ({ value }) as StandardSchemaV1.Result<any>,
      jsonSchema: {
        input: () => jsonSchema,
        output: () => jsonSchema,
      },
    },
  } as StandardSchemaV1 & StandardJSONSchemaV1
}

function makeRequest(body: string): IncomingMessage {
  const stream = Readable.from([body]) as IncomingMessage
  stream.method = `POST`
  stream.url = `/electric-agents`
  stream.headers = { 'content-type': `application/json` }
  return stream
}

function makeErrorRequest(): IncomingMessage {
  const stream = new Readable({
    read() {
      process.nextTick(() => this.destroy(new Error(`Connection reset`)))
    },
  })
  return stream as IncomingMessage
}

function makeResponse() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse & {
    writeHead: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
}

describe(`createRuntimeHandler`, () => {
  beforeEach(() => {
    clearRegistry()
    processWebhookWakeMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it(`responds immediately and processes the wake asynchronously`, async () => {
    defineEntity(`test-agent`, { handler: async () => {} })

    let resolveWake!: () => void
    processWebhookWakeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWake = resolve
        })
    )

    const notification = {
      consumerId: `consumer-1`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/streams/entity:test-1`,
      streams: [{ path: `/streams/entity:test-1`, offset: `0_0` }],
      callback: `http://localhost:3000/_electric/wakes/wake-1`,
      claimToken: `tok-1`,
      entity: {
        type: `test-agent`,
        status: `active`,
        url: `http://localhost:3000/test-agent/test-1`,
        streams: {
          main: `/streams/entity:test-1`,
          error: `/streams/entity-error:test-1`,
        },
      },
    }

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
      heartbeatInterval: 15_000,
      idleTimeout: 60_000,
    })
    const req = makeRequest(JSON.stringify(notification))
    const res = makeResponse()

    await handler.onEnter(req, res)

    expect(res.writeHead).toHaveBeenCalledWith(200, {
      'content-type': `application/json`,
    })
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: true }))
    expect(processWebhookWakeMock).toHaveBeenCalledWith(
      notification,
      expect.objectContaining({
        baseUrl: `http://localhost:3000`,
        heartbeatInterval: 15_000,
        idleTimeout: 60_000,
        shutdownSignal: expect.any(AbortSignal),
      })
    )

    resolveWake()
  })

  it(`exposes pending wake labels through debugState()`, async () => {
    defineEntity(`test-agent`, { handler: async () => {} })

    let resolveWake!: () => void
    processWebhookWakeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWake = resolve
        })
    )

    const notification = {
      consumerId: `consumer-1`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/streams/entity:test-1`,
      streams: [{ path: `/streams/entity:test-1`, offset: `0_0` }],
      callback: `http://localhost:3000/_electric/wakes/wake-1`,
      claimToken: `tok-1`,
      entity: {
        type: `test-agent`,
        status: `active`,
        url: `http://localhost:3000/test-agent/test-1`,
        streams: {
          main: `/streams/entity:test-1`,
          error: `/streams/entity-error:test-1`,
        },
      },
    }

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    const response = await handler.handleWebhookRequest(
      new Request(`http://localhost/electric-agents`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(notification),
      })
    )

    expect(response.status).toBe(200)
    expect(handler.debugState()).toMatchObject({
      pendingWakeCount: 1,
      pendingWakeLabels: [`http://localhost:3000/test-agent/test-1`],
      wakeErrorCount: 0,
      typeNames: [`test-agent`],
    })

    resolveWake()
    await handler.waitForSettled()

    expect(handler.debugState()).toMatchObject({
      pendingWakeCount: 0,
      pendingWakeLabels: [],
      wakeErrorCount: 0,
      typeNames: [`test-agent`],
    })
  })

  it(`records wake errors in debugState() until drained`, async () => {
    defineEntity(`test-agent`, { handler: async () => {} })
    processWebhookWakeMock.mockRejectedValueOnce(new Error(`wake failed`))

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    const notification = {
      consumerId: `consumer-1`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/streams/entity:test-1`,
      streams: [{ path: `/streams/entity:test-1`, offset: `0_0` }],
      callback: `http://localhost:3000/_electric/wakes/wake-1`,
      claimToken: `tok-1`,
      entity: {
        type: `test-agent`,
        status: `active`,
        url: `http://localhost:3000/test-agent/test-1`,
        streams: {
          main: `/streams/entity:test-1`,
          error: `/streams/entity-error:test-1`,
        },
      },
    }

    const response = await handler.handleWebhookRequest(
      new Request(`http://localhost/electric-agents`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(notification),
      })
    )

    expect(response.status).toBe(200)
    await Promise.resolve()
    await Promise.resolve()

    expect(handler.debugState()).toMatchObject({
      pendingWakeCount: 0,
      pendingWakeLabels: [],
      wakeErrorCount: 1,
      typeNames: [`test-agent`],
    })

    await expect(handler.waitForSettled()).rejects.toThrow(`wake failed`)

    expect(handler.debugState()).toMatchObject({
      pendingWakeCount: 0,
      pendingWakeLabels: [],
      wakeErrorCount: 0,
      typeNames: [`test-agent`],
    })
  })

  it(`returns 400 for invalid JSON`, async () => {
    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })
    const req = makeRequest(`{not-json`)
    const res = makeResponse()

    await handler.onEnter(req, res)

    expect(processWebhookWakeMock).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'content-type': `application/json`,
    })
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toMatchObject({
      error: `Invalid JSON`,
      details: expect.any(String),
    })
  })

  it(`exposes typeNames as a live getter`, () => {
    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    defineEntity(`first-agent`, { handler: async () => {} })
    expect(handler.typeNames).toEqual([`first-agent`])

    defineEntity(`second-agent`, { handler: async () => {} })
    expect(handler.typeNames).toEqual([`first-agent`, `second-agent`])
  })

  it(`returns 400 when request body read fails`, async () => {
    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })
    const req = makeErrorRequest()
    const res = makeResponse()

    await handler.onEnter(req, res)

    expect(processWebhookWakeMock).not.toHaveBeenCalled()
    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'content-type': `application/json`,
    })
    expect(JSON.parse(res.end.mock.calls[0]![0] as string)).toMatchObject({
      error: `Request body read failed`,
      details: expect.stringContaining(`Connection reset`),
    })
  })

  it(`exposes a fetch-native router that returns null for non-runtime routes`, async () => {
    const router = createRuntimeRouter({
      baseUrl: `http://localhost:3000`,
      webhookPath: `/custom-runtime`,
    })

    const response = await router.handleRequest(
      new Request(`http://localhost/not-runtime`, { method: `POST` })
    )

    expect(response).toBeNull()
    expect(processWebhookWakeMock).not.toHaveBeenCalled()
  })

  it(`returns 503 for unknown entity types`, async () => {
    const router = createRuntimeRouter({
      baseUrl: `http://localhost:3000`,
      webhookPath: `/custom-runtime`,
    })

    const notification = {
      consumerId: `consumer-1`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/streams/entity:test-1`,
      streams: [{ path: `/streams/entity:test-1`, offset: `0_0` }],
      callback: `http://localhost:3000/_electric/wakes/wake-1`,
      claimToken: `tok-1`,
      entity: {
        type: `nonexistent-agent`,
        status: `active`,
        url: `/nonexistent-agent/test-1`,
        streams: {
          main: `/nonexistent-agent/test-1/main`,
          error: `/nonexistent-agent/test-1/error`,
        },
      },
    }

    const response = await router.handleWebhookRequest(
      new Request(`http://localhost/custom-runtime`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(notification),
      })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(`nonexistent-agent`),
    })
    expect(processWebhookWakeMock).not.toHaveBeenCalled()
  })

  it(`routes matching fetch requests through handleRequest`, async () => {
    defineEntity(`test-agent`, { handler: async () => {} })

    const router = createRuntimeRouter({
      baseUrl: `http://localhost:3000`,
      webhookPath: `/custom-runtime`,
      serveEndpoint: `http://localhost:4000/custom-runtime`,
    })

    const notification = {
      consumerId: `consumer-1`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/streams/entity:test-1`,
      streams: [{ path: `/streams/entity:test-1`, offset: `0_0` }],
      callback: `http://localhost:3000/_electric/wakes/wake-1`,
      claimToken: `tok-1`,
      entity: {
        type: `test-agent`,
        status: `active`,
        url: `http://localhost:3000/test-agent/test-1`,
        streams: {
          main: `/streams/entity:test-1`,
          error: `/streams/entity-error:test-1`,
        },
      },
    }

    const response = await router.handleRequest(
      new Request(`http://localhost/custom-runtime`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(notification),
      })
    )

    expect(response).toBeInstanceOf(Response)
    expect(response?.status).toBe(200)
    await expect(response?.json()).resolves.toEqual({ ok: true })
    expect(processWebhookWakeMock).toHaveBeenCalledWith(
      notification,
      expect.objectContaining({
        baseUrl: `http://localhost:3000`,
        heartbeatInterval: undefined,
        idleTimeout: undefined,
        shutdownSignal: expect.any(AbortSignal),
      })
    )
  })

  it(`registerTypes throws on partial registration failure`, async () => {
    defineEntity(`good-agent`, { handler: async () => {} })
    defineEntity(`bad-agent`, { handler: async () => {} })

    vi.spyOn(globalThis, `fetch`).mockImplementation((url) => {
      if (String(url).includes(`/good-agent/**?subscription=`)) {
        return Promise.resolve(new Response(`server error`, { status: 500 }))
      }

      const body = JSON.stringify(
        String(url).includes(`entity-types`) ? { ok: true } : {}
      )
      return Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
      )
    })

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await expect(handler.registerTypes()).rejects.toThrow(
      `1/2 entity types registered (1 failed: good-agent)`
    )
  })

  it(`registers entity types and creates a serve-endpoint subscription`, async () => {
    defineEntity(`schema-agent`, {
      description: `Schema agent`,
      outputSchemas: { custom: makeStandardSchema({ type: `object` }) },
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/_electric/entity-types`,
      expect.objectContaining({
        method: `POST`,
      })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:3000/schema-agent/**?subscription=schema-agent-handler`,
      expect.objectContaining({
        method: `PUT`,
      })
    )

    const [, options] = fetchMock.mock.calls[0]!
    expect(JSON.parse(options?.body as string)).toMatchObject({
      name: `schema-agent`,
      description: `Schema agent`,
      serve_endpoint: `http://localhost:4000/electric-agents`,
      output_schemas: expect.objectContaining({
        custom: { type: `object` },
        run: expect.any(Object),
        manifest: expect.any(Object),
        child_status: expect.any(Object),
      }),
    })
  })

  it(`registers custom state collections as output schemas`, async () => {
    defineEntity(`stateful-agent`, {
      state: {
        status: {
          schema: makeStandardSchema({
            type: `object`,
            properties: {
              key: { type: `string` },
              value: { type: `string` },
            },
            required: [`key`, `value`],
          }),
          primaryKey: `key`,
        },
      },
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body.output_schemas).toEqual(
      expect.objectContaining({
        'state:status': {
          type: `object`,
          properties: {
            key: { type: `string` },
            value: { type: `string` },
          },
          required: [`key`, `value`],
        },
      })
    )
  })

  it(`strips $schema from standard-schema JSON before registration`, async () => {
    defineEntity(`drafted-agent`, {
      state: {
        status: {
          schema: makeStandardSchema({
            $schema: `https://json-schema.org/draft/2020-12/schema`,
            type: `object`,
            properties: {
              key: { type: `string` },
            },
            required: [`key`],
          }),
          primaryKey: `key`,
        },
      },
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body.output_schemas).toEqual(
      expect.objectContaining({
        'state:status': {
          type: `object`,
          properties: {
            key: { type: `string` },
          },
          required: [`key`],
        },
      })
    )
  })

  it(`omits serve_endpoint when no webhook endpoint is configured`, async () => {
    defineEntity(`pull-wake-agent`, {
      description: `Pull wake agent`,
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const router = createRuntimeRouter({
      baseUrl: `http://localhost:3000`,
    })

    await router.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty(`serve_endpoint`)
  })

  it(`sends creation_schema when creationSchema is defined`, async () => {
    defineEntity(`spawnable-agent`, {
      description: `Spawnable agent`,
      creationSchema: makeStandardSchema({
        type: `object`,
        properties: { userId: { type: `string` } },
        required: [`userId`],
      }),
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body.creation_schema).toEqual({
      type: `object`,
      properties: { userId: { type: `string` } },
      required: [`userId`],
    })
  })

  it(`sends input_schemas when inboxSchemas is defined`, async () => {
    defineEntity(`inbox-agent`, {
      description: `Inbox agent`,
      inboxSchemas: {
        greet: makeStandardSchema({
          type: `object`,
          properties: { name: { type: `string` } },
        }),
      },
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body.input_schemas).toEqual({
      greet: { type: `object`, properties: { name: { type: `string` } } },
    })
  })

  it(`omits creation_schema and input_schemas when neither is defined`, async () => {
    defineEntity(`plain-agent`, {
      description: `Plain agent`,
      handler: async () => {},
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const handler = createRuntimeHandler({
      baseUrl: `http://localhost:3000`,
      handlerUrl: `http://localhost:4000/electric-agents`,
    })

    await handler.registerTypes()

    const [, options] = fetchMock.mock.calls[0]!
    const body = JSON.parse(options?.body as string) as Record<string, unknown>
    expect(body).not.toHaveProperty(`creation_schema`)
    expect(body).not.toHaveProperty(`input_schemas`)
    expect(body).toHaveProperty(`output_schemas`)
  })
})
