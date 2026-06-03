import { describe, expect, it } from 'vitest'
import {
  AGENTS_RESPONSE_HEADER_EXPOSE_ALLOWLIST,
  copyAllowedObserveSearchParams,
  copyAllowedRequestHeaders,
  sanitizeProxiedResponseHeaders,
} from './allowlists'

describe(`agents proxy allowlists`, () => {
  it(`copies offset, cursor, and live=long-poll`, () => {
    const from = new URLSearchParams(`offset=10&cursor=abc&live=long-poll`)
    const to = new URLSearchParams()

    copyAllowedObserveSearchParams(from, to)

    expect([...to.entries()]).toEqual([
      [`offset`, `10`],
      [`live`, `long-poll`],
      [`cursor`, `abc`],
    ])
  })

  it(`does not copy live=sse initially`, () => {
    const to = new URLSearchParams()

    copyAllowedObserveSearchParams(new URLSearchParams(`live=sse`), to)

    expect(to.has(`live`)).toBe(false)
  })

  it(`ignores arbitrary and shape-style params`, () => {
    const from = new URLSearchParams()
    for (const key of [
      `table`,
      `where`,
      `params[1]`,
      `columns`,
      `handle`,
      `path`,
      `stream`,
      `secret`,
      `source`,
      `unknown`,
    ]) {
      from.set(key, `malicious`)
    }
    from.set(`offset`, `safe`)
    const to = new URLSearchParams()

    copyAllowedObserveSearchParams(from, to)

    expect([...to.entries()]).toEqual([[`offset`, `safe`]])
  })

  it(`uses single durable param values`, () => {
    const from = new URLSearchParams(`offset=first&offset=second`)
    const to = new URLSearchParams(`offset=old`)

    copyAllowedObserveSearchParams(from, to)

    expect(to.getAll(`offset`)).toEqual([`first`])
  })

  it(`drops unsafe browser request headers`, () => {
    const from = new Headers({
      authorization: `Bearer browser-token`,
      cookie: `sid=secret`,
      host: `evil.example`,
      'x-forwarded-for': `127.0.0.1`,
      'electric-principal': `browser-principal`,
      'electric-claim-token': `browser-claim`,
      'electric-anything': `browser-electric`,
      'stream-next-offset': `browser-stream`,
      accept: `application/json`,
    })

    const copied = copyAllowedRequestHeaders(from)

    expect([...copied.entries()]).toEqual([])
  })

  it(`strips decompression-sensitive response headers and preserves safe headers`, () => {
    const headers = new Headers({
      'Content-Encoding': `gzip`,
      'Content-Length': `42`,
      'Content-Type': `application/json`,
      'Stream-Next-Offset': `10`,
    })

    const sanitized = sanitizeProxiedResponseHeaders(headers)

    expect(sanitized.has(`content-encoding`)).toBe(false)
    expect(sanitized.has(`content-length`)).toBe(false)
    expect(sanitized.get(`content-type`)).toBe(`application/json`)
    expect(sanitized.get(`stream-next-offset`)).toBe(`10`)
  })

  it(`sets exact CORS expose allowlist when requested`, () => {
    const sanitized = sanitizeProxiedResponseHeaders(new Headers(), {
      exposeCorsHeaders: true,
    })

    expect(sanitized.get(`access-control-expose-headers`)).toBe(
      AGENTS_RESPONSE_HEADER_EXPOSE_ALLOWLIST.join(`, `)
    )
  })

  it(`omits CORS expose header by default`, () => {
    const sanitized = sanitizeProxiedResponseHeaders(new Headers())

    expect(sanitized.has(`access-control-expose-headers`)).toBe(false)
  })
})
