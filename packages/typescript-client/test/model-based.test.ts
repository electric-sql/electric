import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { ShapeStream } from '../src'
import { expiredShapesCache } from '../src/expired-shapes-cache'
import { upToDateTracker } from '../src/up-to-date-tracker'

// ─── Response Factories ─────────────────────────────────────────────
//
// Each factory generates a valid Electric protocol response. A
// monotonically increasing sequence number keeps offsets and cursors
// unique across the entire test run.

let responseSeq = 0

function nextSeq(): number {
  return ++responseSeq
}

function make200WithData(): Response {
  const seq = nextSeq()
  return new Response(
    JSON.stringify([
      {
        offset: `${seq}_0`,
        value: { id: seq },
        headers: { operation: `insert` },
        key: `key-${seq}`,
      },
    ]),
    {
      status: 200,
      headers: {
        'electric-handle': `test-handle`,
        'electric-offset': `${seq}_0`,
        'electric-schema': `{"id":"int4"}`,
        'electric-cursor': `cursor-${seq}`,
      },
    }
  )
}

function make200UpToDate(): Response {
  const seq = nextSeq()
  return new Response(
    JSON.stringify([{ headers: { control: `up-to-date` } }]),
    {
      status: 200,
      headers: {
        'electric-handle': `test-handle`,
        'electric-offset': `${seq}_0`,
        'electric-schema': `{"id":"int4"}`,
        'electric-cursor': `cursor-${seq}`,
        'electric-up-to-date': ``,
      },
    }
  )
}

function make204(): Response {
  const seq = nextSeq()
  return new Response(null, {
    status: 204,
    headers: {
      'electric-handle': `test-handle`,
      'electric-offset': `${seq}_0`,
      'electric-cursor': `cursor-${seq}`,
    },
  })
}

function make400(): Response {
  return new Response(`Bad Request`, {
    status: 400,
    statusText: `Bad Request`,
  })
}

function makeMalformed200(): Response {
  const seq = nextSeq()
  return new Response(JSON.stringify({ error: `not an array` }), {
    status: 200,
    headers: {
      'electric-handle': `test-handle`,
      'electric-offset': `${seq}_0`,
      'electric-schema': `{"id":"int4"}`,
      'electric-cursor': `cursor-${seq}`,
    },
  })
}

// ─── Fetch Gate ─────────────────────────────────────────────────────
//
// A controllable mock fetch that blocks each request until the test
// provides a response. This gives the test full control over the
// server response sequence while letting ShapeStream drive the
// request timing naturally.

class FetchGate {
  private _requestCount = 0
  private _fetchResolve: ((r: Response) => void) | null = null
  private _onRequest: (() => void) | null = null

  get requestCount(): number {
    return this._requestCount
  }

  get hasPendingRequest(): boolean {
    return this._fetchResolve !== null
  }

  readonly fetchClient = async (
    _input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.signal?.aborted) return Response.error()
    this._requestCount++

    // Notify that a new request arrived
    if (this._onRequest) {
      const cb = this._onRequest
      this._onRequest = null
      cb()
    }

    return new Promise<Response>((resolve) => {
      this._fetchResolve = resolve
      init?.signal?.addEventListener(
        `abort`,
        () => {
          if (this._fetchResolve === resolve) {
            this._fetchResolve = null
            resolve(Response.error())
          }
        },
        { once: true }
      )
    })
  }

  waitForRequest(): Promise<void> {
    if (this._fetchResolve) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this._onRequest = resolve
    })
  }

  provideResponse(response: Response): void {
    if (!this._fetchResolve) throw new Error(`No pending fetch request`)
    const resolve = this._fetchResolve
    this._fetchResolve = null
    resolve(response)
  }
}

// ─── Test System (Real) ─────────────────────────────────────────────

interface StreamReal {
  gate: FetchGate
  subscriberError: Error | null
  respond(response: Response): Promise<void>
  cleanup(): void
}

/**
 * Yield to the event loop until the gate has a pending request,
 * meaning the stream has fully processed the previous response and
 * is blocked waiting for the next one.
 */
async function waitUntilBlocked(
  gate: FetchGate,
  subscriberErrorRef: { error: Error | null },
  maxYields = 50
): Promise<void> {
  for (let i = 0; i < maxYields; i++) {
    await new Promise((r) => setTimeout(r, 0))
    if (gate.hasPendingRequest || subscriberErrorRef.error !== null) return
  }
  throw new Error(
    `Stream did not settle: no pending request and no subscriber error after ${maxYields} yields`
  )
}

async function createStreamReal(): Promise<StreamReal> {
  responseSeq = 0
  const gate = new FetchGate()
  const aborter = new AbortController()
  const errorRef = { error: null as Error | null }

  const stream = new ShapeStream({
    url: `https://example.com/v1/shape`,
    params: { table: `test` },
    fetchClient: gate.fetchClient,
    signal: aborter.signal,
    subscribe: true,
    onError: () => ({}), // always retry — the scenario under test
  })

  stream.subscribe(
    () => {},
    (err: Error) => {
      errorRef.error = err
    }
  )

  // Wait for the first fetch, then bootstrap into live mode
  await gate.waitForRequest()
  gate.provideResponse(make200UpToDate())
  await waitUntilBlocked(gate, errorRef)

  return {
    gate,
    get subscriberError() {
      return errorRef.error
    },
    async respond(response: Response) {
      await gate.waitForRequest()
      gate.provideResponse(response)
      await waitUntilBlocked(gate, errorRef)
    },
    cleanup() {
      aborter.abort()
    },
  }
}

// ─── Model ──────────────────────────────────────────────────────────

interface StreamModel {
  consecutiveErrors: number
  terminated: boolean
}

const MAX_CONSECUTIVE_ERROR_RETRIES = 50

// ─── Commands ───────────────────────────────────────────────────────
//
// Each command represents one server response. The `check` method
// gates on the model (skip if stream already terminated), and the
// `run` method updates the model, feeds the response to the real
// system, and asserts consistency.

class Respond200DataCmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.consecutiveErrors = 0
    await r.respond(make200WithData())
    expect(r.subscriberError).toBeNull()
  }
  toString(): string {
    return `Respond200Data`
  }
}

class Respond200UpToDateCmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.consecutiveErrors = 0
    await r.respond(make200UpToDate())
    expect(r.subscriberError).toBeNull()
  }
  toString(): string {
    return `Respond200UpToDate`
  }
}

class Respond204Cmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.consecutiveErrors = 0
    await r.respond(make204())
    expect(r.subscriberError).toBeNull()
  }
  toString(): string {
    return `Respond204`
  }
}

class Respond400Cmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.consecutiveErrors++
    const shouldTerminate = m.consecutiveErrors > MAX_CONSECUTIVE_ERROR_RETRIES
    if (shouldTerminate) m.terminated = true

    await r.respond(make400())

    if (shouldTerminate) {
      expect(r.subscriberError).not.toBeNull()
    } else {
      expect(r.subscriberError).toBeNull()
    }
  }
  toString(): string {
    return `Respond400`
  }
}

class RespondMalformed200Cmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.consecutiveErrors++
    const shouldTerminate = m.consecutiveErrors > MAX_CONSECUTIVE_ERROR_RETRIES
    if (shouldTerminate) m.terminated = true

    await r.respond(makeMalformed200())

    if (shouldTerminate) {
      expect(r.subscriberError).not.toBeNull()
    } else {
      expect(r.subscriberError).toBeNull()
    }
  }
  toString(): string {
    return `RespondMalformed200`
  }
}

// ─── Property Tests ─────────────────────────────────────────────────

describe(`ShapeStream model-based property tests`, () => {
  beforeEach(() => {
    localStorage.clear()
    expiredShapesCache.clear()
    upToDateTracker.clear()
  })

  // Cleanup is handled per-run inside the property via real.cleanup()
  afterEach(() => {})

  it(`bounded retry: any mix of server responses respects the retry limit and counter resets`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc.constant(new Respond200DataCmd()),
            fc.constant(new Respond200UpToDateCmd()),
            fc.constant(new Respond204Cmd()),
            fc.constant(new Respond400Cmd()),
            fc.constant(new RespondMalformed200Cmd()),
          ],
          { maxCommands: 80 }
        ),
        async (cmds) => {
          const real = await createStreamReal()
          const model: StreamModel = {
            consecutiveErrors: 0,
            terminated: false,
          }
          try {
            await fc.asyncModelRun(() => ({ model, real }), cmds)
          } finally {
            real.cleanup()
          }
        }
      ),
      { numRuns: 100 }
    )
  }, 60_000)
})
