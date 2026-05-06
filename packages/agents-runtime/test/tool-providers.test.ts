import { describe, expect, it, beforeEach } from 'vitest'
import {
  registerToolProvider,
  unregisterToolProvider,
  resolveToolProviders,
  __resetToolProvidersForTest,
} from '../src/tool-providers'

describe(`tool-providers`, () => {
  beforeEach(() => __resetToolProvidersForTest())

  it(`registers and resolves provider tools`, async () => {
    registerToolProvider({ name: `mcp`, tools: () => [{ name: `x` } as any] })
    const tools = await resolveToolProviders()
    expect(tools.length).toBe(1)
    expect((tools[0] as any).name).toBe(`x`)
  })

  it(`idempotent re-registration replaces previous`, async () => {
    registerToolProvider({ name: `mcp`, tools: () => [{ name: `a` } as any] })
    registerToolProvider({ name: `mcp`, tools: () => [{ name: `b` } as any] })
    const tools = await resolveToolProviders()
    expect((tools as any[]).map((t) => t.name)).toEqual([`b`])
  })

  it(`unregister removes tools`, async () => {
    registerToolProvider({ name: `mcp`, tools: () => [{ name: `a` } as any] })
    unregisterToolProvider(`mcp`)
    expect(await resolveToolProviders()).toEqual([])
  })

  it(`supports async tools()`, async () => {
    registerToolProvider({
      name: `mcp`,
      tools: async () => [{ name: `c` } as any],
    })
    expect((await resolveToolProviders())[0]).toMatchObject({ name: `c` })
  })

  describe(`sentinel-aware composition (integration)`, () => {
    it(`filterByAllowlist with explicit list keeps only matching servers`, async () => {
      const { filterByAllowlist } = await import(`@electric-ax/agents-mcp`)
      const servers = [`sentry`, `github`, `linear`]
      const result = filterByAllowlist(servers, [`sentry`, `linear`])
      expect(result).toEqual([`sentry`, `linear`])
    })

    it(`filterByAllowlist with wildcard keeps all servers`, async () => {
      const { filterByAllowlist } = await import(`@electric-ax/agents-mcp`)
      const servers = [`sentry`, `github`]
      const result = filterByAllowlist(servers, `*`)
      expect(result).toEqual([`sentry`, `github`])
    })

    it(`isMcpToolsSentinel recognises sentinel objects`, async () => {
      const { isMcpToolsSentinel, mcp } = await import(
        `@electric-ax/agents-mcp`
      )
      const sentinel = mcp.tools([`sentry`])[0]!
      expect(isMcpToolsSentinel(sentinel)).toBe(true)
      expect(isMcpToolsSentinel({ name: `regular-tool` })).toBe(false)
    })
  })
})
