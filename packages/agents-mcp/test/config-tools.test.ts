import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigTools } from '../src/config/config-tools'
import { ConfigStore } from '../src/config/config-store'

describe(`config management tools`, () => {
  let workDir: string
  let configStore: ConfigStore
  let mockPool: any
  let tools: ReturnType<typeof createConfigTools>

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-cfgtools-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    configStore = new ConfigStore(workDir)
    mockPool = {
      addServer: vi.fn(),
      removeServer: vi.fn().mockResolvedValue(undefined),
      acquire: vi.fn().mockResolvedValue({ tools: [], resources: [] }),
      release: vi.fn(),
      getServerStates: vi.fn().mockReturnValue([]),
      getEnabledServers: vi.fn().mockReturnValue([]),
    }
    tools = createConfigTools(configStore, mockPool)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`mcp__manage__add_server saves config and adds to pool`, async () => {
    const addTool = tools.find((t) => t.name === `mcp__manage__add_server`)!
    const result = await addTool.execute(`c1`, {
      name: `github`,
      command: `npx`,
      args: [`-y`, `@mcp/server-github`],
    })
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`github`)
    expect(mockPool.addServer).toHaveBeenCalledWith(
      `github`,
      expect.objectContaining({ command: `npx` })
    )
    const config = configStore.load()
    expect(config.servers.github).toBeDefined()
  })

  it(`mcp__manage__remove_server removes from config and pool`, async () => {
    configStore.save({ servers: { github: { command: `npx` } } })
    const removeTool = tools.find(
      (t) => t.name === `mcp__manage__remove_server`
    )!
    await removeTool.execute(`c2`, { name: `github` })
    expect(mockPool.removeServer).toHaveBeenCalledWith(`github`)
    const config = configStore.load()
    expect(config.servers.github).toBeUndefined()
  })

  it(`mcp__manage__list_servers returns server states`, async () => {
    mockPool.getServerStates.mockReturnValue([
      {
        name: `gh`,
        status: `connected`,
        config: { command: `npx` },
        tools: [{ name: `t1` }],
        resources: [],
      },
    ])
    const listTool = tools.find((t) => t.name === `mcp__manage__list_servers`)!
    const result = await listTool.execute(`c3`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`gh`)
    expect(text).toContain(`connected`)
  })

  it(`mcp__manage__list_tools returns tools from all servers`, async () => {
    mockPool.getEnabledServers.mockReturnValue([{ name: `gh`, config: {} }])
    mockPool.acquire.mockResolvedValue({
      tools: [{ name: `create_issue`, description: `Create issue` }],
    })
    const listToolsTool = tools.find(
      (t) => t.name === `mcp__manage__list_tools`
    )!
    const result = await listToolsTool.execute(`c4`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`create_issue`)
  })
})
