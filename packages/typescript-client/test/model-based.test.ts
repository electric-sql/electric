import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { ShapeStream } from '../src'
import { expiredShapesCache } from '../src/expired-shapes-cache'
import { upToDateTracker } from '../src/up-to-date-tracker'

// ─── Response Factories ─────────────────────────────────────────────
//
// Each factory generates a valid Electric protocol response. A
// monotonically increasing sequence number keeps offsets and cursors
// unique across the test run, preventing stale-response detection
// from firing unexpectedly. All factories accept a `handle` parameter
// so that responses stay consistent after 409 rotations.

let responseSeq = 0

function nextSeq(): number {
  return ++responseSeq
}

/** All Electric headers — valid for both live and non-live requests. */
function allHeaders(handle: string): Record<string, string> {
  const seq = responseSeq // use current seq without incrementing
  return {
    'electric-handle': handle,
    'electric-offset': `${seq}_0`,
    'electric-schema': `{"id":"int4"}`,
    'electric-cursor': `cursor-${seq}`,
  }
}

/** Valid 200 with one data message. Resets the error retry counter. */
function make200WithData(handle: string): Response {
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
    { status: 200, headers: allHeaders(handle) }
  )
}

/** Valid 200 with up-to-date control message. Resets the error retry counter. */
function make200UpToDate(handle: string): Response {
  nextSeq()
  return new Response(
    JSON.stringify([{ headers: { control: `up-to-date` } }]),
    {
      status: 200,
      headers: { ...allHeaders(handle), 'electric-up-to-date': `` },
    }
  )
}

/** Valid 200 with empty body []. Does NOT reset the error retry counter. */
function make200Empty(handle: string): Response {
  nextSeq()
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: allHeaders(handle),
  })
}

/** 204 No Content. Resets the error retry counter. */
function make204(handle: string): Response {
  nextSeq()
  return new Response(null, {
    status: 204,
    headers: allHeaders(handle),
  })
}

/** 400 Bad Request. Bypasses backoff, goes straight to onError. */
function make400(): Response {
  return new Response(`Bad Request`, {
    status: 400,
    statusText: `Bad Request`,
  })
}

/**
 * 409 Conflict (shape rotation). Caught by #requestShape internally —
 * does NOT go through onError, does NOT affect the retry counter.
 * Returns a unique new handle so that subsequent responses avoid
 * stale-cache detection.
 */
function make409(newHandle: string): Response {
  return new Response(
    JSON.stringify([{ headers: { control: `must-refetch` } }]),
    {
      status: 409,
      headers: {
        'electric-handle': newHandle,
        'content-type': `application/json`,
      },
    }
  )
}

/**
 * 409 Conflict without a handle header. Simulates a proxy stripping
 * the header. Must always produce a unique retry URL via cache buster.
 */
function make409NoHandle(): Response {
  return new Response(
    JSON.stringify([{ headers: { control: `must-refetch` } }]),
    {
      status: 409,
      headers: {
        'content-type': `application/json`,
      },
    }
  )
}

/** Valid headers but non-array body. Throws FetchError → onError. */
function makeMalformed200(handle: string): Response {
  nextSeq()
  return new Response(JSON.stringify({ error: `not an array` }), {
    status: 200,
    headers: allHeaders(handle),
  })
}

/**
 * 200 OK but missing required Electric headers.
 * Throws MissingHeadersError which is NOT retryable — terminates immediately.
 */
function make200MissingHeaders(): Response {
  return new Response(JSON.stringify([]), {
    status: 200,
    headers: {},
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

  /** Last two request URLs — used to verify no identity loops. */
  lastUrl: string | null = null
  prevUrl: string | null = null

  /** Maximum URL length seen across all requests. */
  maxUrlLength = 0

  get requestCount(): number {
    return this._requestCount
  }

  get hasPendingRequest(): boolean {
    return this._fetchResolve !== null
  }

  readonly fetchClient = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.signal?.aborted) return Response.error()
    this._requestCount++

    const urlStr = input.toString()
    this.prevUrl = this.lastUrl
    this.lastUrl = urlStr
    this.maxUrlLength = Math.max(this.maxUrlLength, urlStr.length)

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
  stream: ShapeStream
  subscriberError: Error | null
  currentHandle: string
  respond(response: Response): Promise<void>
  cleanup(): void
}

/**
 * Yield to the event loop until the gate has a pending request
 * (stream processed the response and is blocked on next fetch)
 * or the stream terminated (subscriber error set).
 */
async function waitUntilSettled(
  gate: FetchGate,
  errorRef: { error: Error | null },
  maxYields = 50
): Promise<void> {
  for (let i = 0; i < maxYields; i++) {
    await new Promise((r) => setTimeout(r, 0))
    if (gate.hasPendingRequest || errorRef.error !== null) return
  }
  throw new Error(
    `Stream did not settle: no pending request and no subscriber error after ${maxYields} yields`
  )
}

/** Reset all shared state to prevent cross-iteration pollution. */
function resetSharedState(): void {
  responseSeq = 0
  localStorage.clear()
  expiredShapesCache.clear()
  upToDateTracker.clear()
}

async function createStreamReal(): Promise<StreamReal> {
  resetSharedState()

  const initialHandle = `test-handle`
  const gate = new FetchGate()
  const aborter = new AbortController()
  const errorRef = { error: null as Error | null }
  const handleRef = { current: initialHandle }

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
  gate.provideResponse(make200UpToDate(initialHandle))
  await waitUntilSettled(gate, errorRef)

  return {
    gate,
    stream,
    get subscriberError() {
      return errorRef.error
    },
    get currentHandle() {
      return handleRef.current
    },
    set currentHandle(h: string) {
      handleRef.current = h
    },
    async respond(response: Response) {
      await gate.waitForRequest()
      gate.provideResponse(response)
      await waitUntilSettled(gate, errorRef)
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
const MAX_URL_LENGTH = 2000

/**
 * Invariants checked after every command. These catch historical bugs
 * like URL identity loops (bug #1), `-next` suffix growth (bug #3),
 * and handle/offset mismatches (bug #10).
 */
function assertGlobalInvariants(r: StreamReal): void {
  expect(r.gate.maxUrlLength).toBeLessThan(MAX_URL_LENGTH)

  if (!r.subscriberError && r.stream.isUpToDate) {
    expect(r.stream.lastSyncedAt()).toBeDefined()
  }
}

/**
 * Asserts that a 409 response produced a unique retry URL, catching
 * identity-loop bugs where the retry URL matches the pre-409 URL.
 */
function assert409ProducedUniqueUrl(
  r: StreamReal,
  prevUrl: string | null
): void {
  expect(r.subscriberError).toBeNull()
  assertGlobalInvariants(r)
  if (prevUrl) {
    expect(r.gate.lastUrl).not.toBe(prevUrl)
  }
}

// ─── Commands ───────────────────────────────────────────────────────
//
// Each command represents one server response. The model predicts
// the expected state change, and assertions verify the real system
// matches. fast-check generates adversarial sequences and shrinks
// failures to minimal reproductions.

/**
 * Shared logic for successful responses that reset the consecutive error
 * counter and should not produce a subscriber error.
 */
async function runSuccessResponse(
  m: StreamModel,
  r: StreamReal,
  response: Response
): Promise<void> {
  m.consecutiveErrors = 0
  await r.respond(response)
  expect(r.subscriberError).toBeNull()
  assertGlobalInvariants(r)
}

/** 200 with data — counter resets to 0 */
class Respond200DataCmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    await runSuccessResponse(m, r, make200WithData(r.currentHandle))
  }
  toString(): string {
    return `Respond200Data`
  }
}

/** 200 with up-to-date control — counter resets to 0 */
class Respond200UpToDateCmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    await runSuccessResponse(m, r, make200UpToDate(r.currentHandle))
  }
  toString(): string {
    return `Respond200UpToDate`
  }
}

/**
 * 200 with empty body [] — does NOT reset counter.
 * The counter reset in #onMessages is gated by `if (batch.length === 0) return`.
 */
class Respond200EmptyCmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(_m: StreamModel, r: StreamReal): Promise<void> {
    await r.respond(make200Empty(r.currentHandle))
    expect(r.subscriberError).toBeNull()
    assertGlobalInvariants(r)
  }
  toString(): string {
    return `Respond200Empty`
  }
}

/** 204 No Content — counter resets to 0 */
class Respond204Cmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    await runSuccessResponse(m, r, make204(r.currentHandle))
  }
  toString(): string {
    return `Respond204`
  }
}

/**
 * Shared logic for error responses that increment the consecutive error
 * counter and may terminate the stream after MAX_CONSECUTIVE_ERROR_RETRIES.
 */
async function runRetryableErrorResponse(
  m: StreamModel,
  r: StreamReal,
  response: Response
): Promise<void> {
  m.consecutiveErrors++
  const shouldTerminate = m.consecutiveErrors > MAX_CONSECUTIVE_ERROR_RETRIES
  if (shouldTerminate) m.terminated = true

  await r.respond(response)

  if (shouldTerminate) {
    expect(r.subscriberError).not.toBeNull()
  } else {
    expect(r.subscriberError).toBeNull()
    assertGlobalInvariants(r)
  }
}

/** 400 Bad Request — counter increments, may terminate at >50 */
class Respond400Cmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    await runRetryableErrorResponse(m, r, make400())
  }
  toString(): string {
    return `Respond400`
  }
}

/**
 * 409 Conflict — caught internally by #requestShape, does NOT go
 * through onError, does NOT affect the retry counter. Rotates to
 * a unique handle so subsequent responses avoid stale-cache detection.
 */
class Respond409Cmd implements fc.AsyncCommand<StreamModel, StreamReal> {
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(_m: StreamModel, r: StreamReal): Promise<void> {
    const prevUrl = r.gate.lastUrl
    const newHandle = `handle-${nextSeq()}`
    await r.respond(make409(newHandle))
    r.currentHandle = newHandle
    assert409ProducedUniqueUrl(r, prevUrl)
  }
  toString(): string {
    return `Respond409`
  }
}

/** Malformed 200 (non-array body) — counter increments, may terminate */
class RespondMalformed200Cmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    await runRetryableErrorResponse(m, r, makeMalformed200(r.currentHandle))
  }
  toString(): string {
    return `RespondMalformed200`
  }
}

/**
 * 200 with missing Electric headers — throws MissingHeadersError which
 * is NOT retryable. Stream terminates immediately regardless of counter.
 */
class RespondMissingHeadersCmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(m: StreamModel, r: StreamReal): Promise<void> {
    m.terminated = true
    await r.respond(make200MissingHeaders())
    expect(r.subscriberError).not.toBeNull()
  }
  toString(): string {
    return `RespondMissingHeaders`
  }
}

/**
 * 409 Conflict without a handle header (proxy stripped it).
 * Handled by creating a random cache buster. Does NOT affect
 * the retry counter — same as normal 409.
 */
class Respond409NoHandleCmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(_m: StreamModel, r: StreamReal): Promise<void> {
    const prevUrl = r.gate.lastUrl
    await r.respond(make409NoHandle())
    r.currentHandle = ``
    assert409ProducedUniqueUrl(r, prevUrl)
  }
  toString(): string {
    return `Respond409NoHandle`
  }
}

/**
 * 409 with the same handle as the current one.
 */
class Respond409SameHandleCmd
  implements fc.AsyncCommand<StreamModel, StreamReal>
{
  check(m: Readonly<StreamModel>): boolean {
    return !m.terminated
  }
  async run(_m: StreamModel, r: StreamReal): Promise<void> {
    const prevUrl = r.gate.lastUrl
    await r.respond(make409(r.currentHandle))
    assert409ProducedUniqueUrl(r, prevUrl)
  }
  toString(): string {
    return `Respond409SameHandle`
  }
}

// ─── Scenario Tests ────────────────────────────────────────────────

describe(`ShapeStream targeted scenario tests`, () => {
  it(`409 publishes only a synthetic must-refetch control message`, async () => {
    resetSharedState()

    const initialHandle = `test-handle`
    const gate = new FetchGate()
    const aborter = new AbortController()
    const errorRef = { error: null as Error | null }
    const receivedBatches: unknown[][] = []

    const stream = new ShapeStream({
      url: `https://example.com/v1/shape`,
      params: { table: `test` },
      fetchClient: gate.fetchClient,
      signal: aborter.signal,
      subscribe: true,
      onError: () => ({}),
    })

    stream.subscribe(
      (msgs) => {
        receivedBatches.push(msgs)
      },
      (err: Error) => {
        errorRef.error = err
      }
    )

    // Bootstrap into live mode
    await gate.waitForRequest()
    gate.provideResponse(make200UpToDate(initialHandle))
    await waitUntilSettled(gate, errorRef)

    receivedBatches.length = 0

    // Send a 409 — client resets and publishes a synthetic must-refetch
    await gate.waitForRequest()
    gate.provideResponse(make409(`new-handle`))
    await waitUntilSettled(gate, errorRef)

    // Subscriber should receive only the synthetic must-refetch control
    // message — no data rows from the raw 409 response body
    expect(receivedBatches).toHaveLength(1)
    expect(receivedBatches[0]).toEqual([
      { headers: { control: `must-refetch` } },
    ])

    aborter.abort()
  })

  it(`consecutive 409s with the same handle produce unique retry URLs`, async () => {
    const real = await createStreamReal()
    try {
      // Advance to a non-initial offset so the first 409 reset is visible
      await real.respond(make200WithData(real.currentHandle))

      // First 409 with same handle — URL changes because offset resets to -1
      const urlBefore = real.gate.lastUrl
      await real.respond(make409(real.currentHandle))
      expect(real.gate.lastUrl).not.toBe(urlBefore)

      // Second 409 with same handle — offset is already -1, handle unchanged.
      // Without a cache buster, the retry URL would be identical.
      const urlAfterFirstRetry = real.gate.lastUrl
      await real.respond(make409(real.currentHandle))
      expect(real.gate.lastUrl).not.toBe(urlAfterFirstRetry)
    } finally {
      real.cleanup()
    }
  })
})

// ─── Property Tests ─────────────────────────────────────────────────

describe(`ShapeStream model-based property tests`, () => {
  it(`bounded retry: any mix of server responses respects the retry limit and counter resets`, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            fc.constant(new Respond200DataCmd()),
            fc.constant(new Respond200UpToDateCmd()),
            fc.constant(new Respond200EmptyCmd()),
            fc.constant(new Respond204Cmd()),
            fc.constant(new Respond400Cmd()),
            fc.constant(new Respond409Cmd()),
            fc.constant(new Respond409SameHandleCmd()),
            fc.constant(new Respond409NoHandleCmd()),
            fc.constant(new RespondMalformed200Cmd()),
            fc.constant(new RespondMissingHeadersCmd()),
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
      { numRuns: 200 }
    )
  }, 120_000)
})
