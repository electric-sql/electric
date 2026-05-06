import { describe, expect, it } from 'vitest'
import { createMcpTools } from '../src/tools'
import type { Registry, ServerEntry } from '../src/registry'

const fakeRegistry: Registry = {
  list: () =>
    [
      {
        name: `github`,
        config: {} as never,
        status: `healthy`,
        tools: [{ name: `create_issue` }, { name: `get_pr` }],
      },
      {
        name: `sentry`,
        config: {} as never,
        status: `healthy`,
        tools: [{ name: `list_events` }],
      },
    ] as ServerEntry[],
  get: (n: string) => fakeRegistry.list().find((s) => s.name === n),
  applyConfig: async () => {},
  invokeMethod: async () => ({}),
  disable: () => {},
  enable: () => {},
  subscribeToProgress: () => () => {},
}

describe(`createMcpTools`, () => {
  it(`selects by allowlist`, () => {
    const tools = createMcpTools(fakeRegistry, [`github`]).tools()
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__github__create_issue`,
      `mcp__github__get_pr`,
      `mcp__github__list_resources`,
      `mcp__github__read_resource`,
      `mcp__github__list_prompts`,
      `mcp__github__get_prompt`,
    ])
  })

  it(`returns all on wildcard`, () => {
    const tools = createMcpTools(fakeRegistry, `*`).tools()
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__github__create_issue`,
      `mcp__github__get_pr`,
      `mcp__github__list_resources`,
      `mcp__github__read_resource`,
      `mcp__github__list_prompts`,
      `mcp__github__get_prompt`,
      `mcp__sentry__list_events`,
      `mcp__sentry__list_resources`,
      `mcp__sentry__read_resource`,
      `mcp__sentry__list_prompts`,
      `mcp__sentry__get_prompt`,
    ])
  })

  it(`empty list when allowlist matches nothing`, () => {
    const tools = createMcpTools(fakeRegistry, [`nonexistent`]).tools()
    expect(tools).toEqual([])
  })
})
