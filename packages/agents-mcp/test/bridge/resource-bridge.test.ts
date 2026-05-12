import { describe, expect, it, vi } from 'vitest'
import { buildResourceTools } from '../../src/bridge/resource-bridge'

describe(`resource bridge`, () => {
  it(`emits list_resources and read_resource tools with correct prefixed names`, () => {
    const client = {
      listResources: vi.fn(async () => ({
        resources: [{ uri: `file:///a`, name: `a` }],
      })),
      readResource: vi.fn(async () => ({
        contents: [{ uri: `file:///a`, text: `data` }],
      })),
    } as any
    const tools = buildResourceTools({ server: `mock`, client })
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__mock__list_resources`,
      `mcp__mock__read_resource`,
    ])
  })

  it(`list_resources returns the raw SDK result`, async () => {
    const client = {
      listResources: vi.fn(async () => ({
        resources: [{ uri: `u`, name: `n` }],
      })),
    } as any
    const [list] = buildResourceTools({ server: `mock`, client })
    expect(await list!.call({})).toEqual({
      resources: [{ uri: `u`, name: `n` }],
    })
  })

  it(`read_resource forwards uri`, async () => {
    const readResource = vi.fn(async () => ({
      contents: [{ uri: `u`, text: `x` }],
    }))
    const client = {
      listResources: async () => ({ resources: [] }),
      readResource,
    } as any
    const [, read] = buildResourceTools({ server: `mock`, client })
    await read!.call({ uri: `u` })
    expect(readResource).toHaveBeenCalledWith({ uri: `u` })
  })
})
