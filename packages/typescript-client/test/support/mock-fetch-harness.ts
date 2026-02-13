import { vi } from 'vitest'
import { ShapeStream } from '../../src'
import type { Schema } from '../../src/types'

// ─── Response template helpers ───

export function upToDateResponse(opts?: {
  handle?: string
  offset?: string
  cursor?: string
  schema?: Schema
}): Response {
  const handle = opts?.handle ?? `test-handle`
  const offset = opts?.offset ?? `0_0`
  const cursor = opts?.cursor ?? `cursor-1`
  const schema = opts?.schema ?? {}

  return new Response(
    JSON.stringify([{ headers: { control: `up-to-date` } }]),
    {
      status: 200,
      headers: new Headers({
        'electric-handle': handle,
        'electric-offset': offset,
        'electric-schema': JSON.stringify(schema),
        'electric-cursor': cursor,
      }),
    }
  )
}

export function initialSyncResponse(opts?: {
  handle?: string
  offset?: string
  cursor?: string
  schema?: Schema
  messages?: object[]
}): Response {
  const handle = opts?.handle ?? `test-handle`
  const offset = opts?.offset ?? `0_0`
  const cursor = opts?.cursor ?? `cursor-1`
  const schema = opts?.schema ?? {}
  const messages = opts?.messages ?? []

  return new Response(JSON.stringify(messages), {
    status: 200,
    headers: new Headers({
      'electric-handle': handle,
      'electric-offset': offset,
      'electric-schema': JSON.stringify(schema),
      'electric-cursor': cursor,
    }),
  })
}

export function staleResponse(opts?: {
  handle?: string
  expiredHandle?: string
  offset?: string
}): Response {
  const handle = opts?.handle ?? `stale-handle`
  const offset = opts?.offset ?? `0_0`

  return new Response(JSON.stringify([]), {
    status: 200,
    headers: new Headers({
      'electric-handle': handle,
      'electric-offset': offset,
      'electric-schema': ``,
      'electric-cursor': ``,
      ...(opts?.expiredHandle
        ? { 'electric-expired-handle': opts.expiredHandle }
        : {}),
    }),
  })
}

export function mustRefetchResponse(): Response {
  return new Response(JSON.stringify({ message: `Must refetch` }), {
    status: 409,
    headers: new Headers({
      'content-type': `application/json`,
    }),
  })
}

export function errorResponse(status: number, body?: string): Response {
  return new Response(body ?? JSON.stringify({ message: `Error` }), {
    status,
    headers: new Headers({
      'content-type': `application/json`,
    }),
  })
}

// ─── MockFetchHarness ───

export class MockFetchHarness {
  #responses: Response[] = []
  #requests: Array<{ input: string | URL | Request; init?: RequestInit }> = []
  #consumedCount = 0
  #fallback?: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Response | Promise<Response>

  enqueue(...responses: Response[]): this {
    this.#responses.push(...responses)
    return this
  }

  onFallback(
    handler: (
      input: string | URL | Request,
      init?: RequestInit
    ) => Response | Promise<Response>
  ): this {
    this.#fallback = handler
    return this
  }

  get fetchClient(): typeof fetch {
    return async (
      input: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      this.#requests.push({ input, init })
      const idx = this.#consumedCount
      this.#consumedCount++

      if (idx < this.#responses.length) {
        return this.#responses[idx].clone()
      }
      if (this.#fallback) {
        return this.#fallback(input, init)
      }
      throw new Error(
        `MockFetchHarness: no response at index ${idx} and no fallback`
      )
    }
  }

  get requests() {
    return [...this.#requests]
  }

  get consumedCount() {
    return this.#consumedCount
  }

  get pendingCount() {
    return this.#responses.length - this.#consumedCount
  }
}

// ─── mockVisibilityApi (extracted from client.test.ts) ───

export function mockVisibilityApi(): {
  pause: () => void
  resume: () => void
} {
  const doc = {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }

  global.document = doc as unknown as Document

  const invokeHandlers = () => {
    const visibilityHandlers = doc.addEventListener.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ([_, handler]: any) => handler
    )
    visibilityHandlers.forEach((handler: () => void) => handler())
  }

  return {
    pause: () => {
      doc.hidden = true
      invokeHandlers()
    },
    resume: () => {
      doc.hidden = false
      invokeHandlers()
    },
  }
}

// ─── createMockShapeStream factory ───

export interface MockShapeStreamContext {
  harness: MockFetchHarness
  visibility: { pause: () => void; resume: () => void }
  aborter: AbortController
  stream: ShapeStream
}

export function createMockShapeStream(opts?: {
  responses?: Response[]
  fallback?: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Response | Promise<Response>
  table?: string
  url?: string
  liveSse?: boolean
}): MockShapeStreamContext {
  const harness = new MockFetchHarness()
  if (opts?.responses) {
    harness.enqueue(...opts.responses)
  }
  if (opts?.fallback) {
    harness.onFallback(opts.fallback)
  }

  const visibility = mockVisibilityApi()
  const aborter = new AbortController()

  const stream = new ShapeStream({
    url: opts?.url ?? `http://localhost:3000/v1/shape`,
    params: { table: opts?.table ?? `test_table` },
    fetchClient: harness.fetchClient,
    signal: aborter.signal,
    liveSse: opts?.liveSse ?? false,
  })

  return { harness, visibility, aborter, stream }
}
