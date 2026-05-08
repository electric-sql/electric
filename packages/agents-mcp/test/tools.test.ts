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

  it(`no-arg call produces a wildcard sentinel (every registered server)`, () => {
    const [s] = mcp.tools()
    expect((s as any).allowlist).toBeUndefined()
  })

  it(`filterByAllowlist returns matching servers (or all when undefined)`, () => {
    expect(filterByAllowlist([`a`, `b`, `c`], [`a`, `c`])).toEqual([`a`, `c`])
    expect(filterByAllowlist([`a`, `b`], undefined)).toEqual([`a`, `b`])
    expect(filterByAllowlist([`a`, `b`], [`nope`])).toEqual([])
  })
})
