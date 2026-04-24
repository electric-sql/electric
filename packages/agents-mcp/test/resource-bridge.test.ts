import { describe, expect, it, vi } from 'vitest'
import { createResourceTools } from '../src/bridge/resource-bridge'

describe(`createResourceTools`, () => {
  const mockPool = {
    getEnabledServers: vi
      .fn()
      .mockReturnValue([{ name: `github`, config: {} }]),
    acquire: vi.fn().mockResolvedValue({
      listResources: vi
        .fn()
        .mockResolvedValue([
          { uri: `repo://org/repo`, name: `repo`, description: `A repo` },
        ]),
      readResource: vi
        .fn()
        .mockResolvedValue([{ type: `text`, text: `file content here` }]),
    }),
    release: vi.fn(),
  }

  it(`creates two tools: mcp__list_resources and mcp__read_resource`, () => {
    const tools = createResourceTools(mockPool as any)
    expect(tools).toHaveLength(2)
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__list_resources`,
      `mcp__read_resource`,
    ])
  })

  it(`mcp__list_resources returns resources from connected servers`, async () => {
    const tools = createResourceTools(mockPool as any)
    const listTool = tools.find((t) => t.name === `mcp__list_resources`)!
    const result = await listTool.execute(`c1`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`github`)
    expect(text).toContain(`repo://org/repo`)
  })

  it(`mcp__read_resource reads a resource by server + URI`, async () => {
    const tools = createResourceTools(mockPool as any)
    const readTool = tools.find((t) => t.name === `mcp__read_resource`)!
    const result = await readTool.execute(`c2`, {
      server: `github`,
      uri: `repo://org/repo`,
    })
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`file content here`)
  })
})
