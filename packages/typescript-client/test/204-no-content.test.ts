import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShapeStream } from '../src'
import { resolveInMacrotask } from './support/test-helpers'

describe(`204 No Content backward compatibility`, () => {
  const shapeUrl = `https://example.com/v1/shape`
  let aborter: AbortController

  beforeEach(() => {
    localStorage.clear()
    aborter = new AbortController()
  })

  afterEach(() => aborter.abort())

  it(`client should go live after receiving a 204 response`, async () => {
    // Simulates a deprecated server that ONLY sends 204 responses from the
    // start (no initial 200 with up-to-date message). The client should
    // recognize the 204 as "you're caught up" and transition to live.

    let fetchCount = 0
    const maxFetches = 5

    const fetchMock = (
      _input: RequestInfo | URL,
      _init?: RequestInit
    ): Promise<Response> => {
      fetchCount++

      if (fetchCount >= maxFetches) {
        // Stop after N fetches to prevent infinite loop in the test
        aborter.abort()
      }

      // Every response is 204 No Content
      return resolveInMacrotask(
        new Response(null, {
          status: 204,
          headers: {
            'electric-handle': `h1`,
            'electric-offset': `0_0`,
            'electric-schema': `{}`,
          },
        })
      )
    }

    const stream = new ShapeStream({
      url: shapeUrl,
      params: { table: `test` },
      signal: aborter.signal,
      fetchClient: fetchMock,
      subscribe: false,
    })

    // Subscribe to drive the fetch loop
    const unsub = stream.subscribe(() => {})

    // Wait for fetches to complete
    await new Promise((resolve) => setTimeout(resolve, 100))
    unsub()

    // BUG: The client should be up-to-date after the first 204, but it
    // never transitions to live and keeps spinning in catch-up mode.
    expect(stream.isUpToDate).toBe(true)
    expect(stream.isLoading()).toBe(false)
    expect(fetchCount).toBeLessThan(maxFetches) // should go live, not exhaust all fetches
  })
})
