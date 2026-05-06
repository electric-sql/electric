import { describe, expect, it } from 'vitest'
import { mcp, isMcpToolsSentinel, filterByAllowlist } from '../src/tools'

describe(`mcp.tools`, () => {
  it(`returns a sentinel array containing the allowlist`, () => {
    const out = mcp.tools([`sentry`, `github`])
    expect(out.length).toBe(1)
    const s = out[0]!
    expect(isMcpToolsSentinel(s)).toBe(true)
    expect((s as any).allowlist).toEqual([`sentry`, `github`])
  })

  it(`'*' produces a wildcard sentinel`, () => {
    const [s] = mcp.tools(`*`)
    expect((s as any).allowlist).toBe(`*`)
  })

  it(`filterByAllowlist returns matching servers (or all when "*")`, () => {
    expect(filterByAllowlist([`a`, `b`, `c`], [`a`, `c`])).toEqual([`a`, `c`])
    expect(filterByAllowlist([`a`, `b`], `*`)).toEqual([`a`, `b`])
    expect(filterByAllowlist([`a`, `b`], [`nope`])).toEqual([])
  })
})
