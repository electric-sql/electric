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
}

describe(`createMcpTools`, () => {
  it(`selects by allowlist`, () => {
    const tools = createMcpTools(fakeRegistry, [`github`]).tools()
    expect(tools.map((t) => t.name)).toEqual([
      `github.create_issue`,
      `github.get_pr`,
    ])
  })

  it(`returns all on wildcard`, () => {
    const tools = createMcpTools(fakeRegistry, `*`).tools()
    expect(tools.map((t) => t.name)).toEqual([
      `github.create_issue`,
      `github.get_pr`,
      `sentry.list_events`,
    ])
  })

  it(`empty list when allowlist matches nothing`, () => {
    const tools = createMcpTools(fakeRegistry, [`nonexistent`]).tools()
    expect(tools).toEqual([])
  })
})
