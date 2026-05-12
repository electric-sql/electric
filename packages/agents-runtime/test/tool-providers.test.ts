import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import {
  registerToolProvider,
  unregisterToolProvider,
  resolveToolProviders,
  composeToolsWithProviders,
  __resetToolProvidersForTest,
} from '../src/tool-providers'
import { runtimeLog } from '../src/log'
import { mcp } from '@electric-ax/agents-mcp'

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

    it(`filterByAllowlist with no allowlist keeps all servers`, async () => {
      const { filterByAllowlist } = await import(`@electric-ax/agents-mcp`)
      const servers = [`sentry`, `github`]
      const result = filterByAllowlist(servers, undefined)
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

describe(`composeToolsWithProviders (wake-time sentinel composition)`, () => {
  beforeEach(() => __resetToolProvidersForTest())

  it(`expands an explicit allowlist to only matching servers tools`, async () => {
    registerToolProvider({
      name: `mcp`,
      tools: () => [
        { name: `mcp__a__t1`, server: `a` },
        { name: `mcp__b__t1`, server: `b` },
        { name: `mcp__c__t1`, server: `c` },
      ],
    })
    const declared = [...mcp.tools([`a`, `c`])]
    const composed = await composeToolsWithProviders(declared)
    const names = (composed as Array<{ name: string }>)
      .map((t) => t.name)
      .sort()
    expect(names).toEqual([`mcp__a__t1`, `mcp__c__t1`])
  })

  it(`no-arg sentinel gets every provider tool`, async () => {
    registerToolProvider({
      name: `mcp`,
      tools: () => [
        { name: `mcp__a__t1`, server: `a` },
        { name: `mcp__b__t1`, server: `b` },
      ],
    })
    const declared = [...mcp.tools()]
    const composed = await composeToolsWithProviders(declared)
    expect(composed).toHaveLength(2)
  })

  it(`entity type with no sentinel sees no MCP tools`, async () => {
    registerToolProvider({
      name: `mcp`,
      tools: () => [{ name: `mcp__a__t1`, server: `a` }],
    })
    const staticTool = { name: `static-thing` }
    const declared = [staticTool]
    const composed = await composeToolsWithProviders(declared)
    expect(composed).toEqual([staticTool])
  })

  describe(`missing-server warnings`, () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      warnSpy = vi.spyOn(runtimeLog, `warn`).mockImplementation(() => {})
    })
    afterEach(() => {
      warnSpy.mockRestore()
    })

    it(`warns once per call, listing every missing named server`, async () => {
      registerToolProvider({
        name: `mcp`,
        tools: () => [{ name: `mcp__a__t1`, server: `a` }],
      })
      const declared = [...mcp.tools([`a`, `github`, `linear`])]
      await composeToolsWithProviders(declared)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const [, message] = warnSpy.mock.calls[0]!
      expect(message).toContain(`"github"`)
      expect(message).toContain(`"linear"`)
      // The available server is not flagged.
      expect(message).not.toContain(`"a"`)
    })

    it(`dedupes missing names across multiple sentinels`, async () => {
      registerToolProvider({
        name: `mcp`,
        tools: () => [],
      })
      // Two sentinels both naming "github" — should produce a single
      // line with "github" listed once, not twice.
      const declared = [
        ...mcp.tools([`github`]),
        ...mcp.tools([`github`, `sentry`]),
      ]
      await composeToolsWithProviders(declared)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const [, message] = warnSpy.mock.calls[0]!
      const githubMatches = (message as string).match(/"github"/g) ?? []
      expect(githubMatches.length).toBe(1)
      expect(message).toContain(`"sentry"`)
    })

    it(`silent for wildcard sentinel even with no servers ready`, async () => {
      registerToolProvider({ name: `mcp`, tools: () => [] })
      const declared = [...mcp.tools()]
      await composeToolsWithProviders(declared)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it(`silent when every named server is available`, async () => {
      registerToolProvider({
        name: `mcp`,
        tools: () => [
          { name: `mcp__a__t1`, server: `a` },
          { name: `mcp__b__t1`, server: `b` },
        ],
      })
      const declared = [...mcp.tools([`a`, `b`])]
      await composeToolsWithProviders(declared)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it(`silent when there are no sentinels at all`, async () => {
      registerToolProvider({ name: `mcp`, tools: () => [] })
      const declared = [{ name: `static-thing` }]
      await composeToolsWithProviders(declared)
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
