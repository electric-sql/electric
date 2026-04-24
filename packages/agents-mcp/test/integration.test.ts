import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpIntegration } from '../src/integration'

// Mock the McpClient to avoid real subprocess/network calls
vi.mock(`../src/client`, () => {
  const McpClient = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.serverName = opts.serverName
    this.tools = [
      {
        name: `echo`,
        description: `Echoes input`,
        inputSchema: {
          type: `object`,
          properties: { text: { type: `string` } },
        },
      },
    ]
    this.resources = []
    this.instructions = `Use echo to test`
    this.sessionId = `session-1`
    this.protocolVersion = `2025-06-18`
    this.connect = vi.fn().mockResolvedValue(undefined)
    this.discover = vi.fn().mockResolvedValue(undefined)
    this.close = vi.fn().mockResolvedValue(undefined)
    this.callTool = vi
      .fn()
      .mockImplementation(async (_name: string, args: any) => ({
        content: [{ type: `text`, text: `echo: ${args.text}` }],
        isError: false,
      }))
    this.listResources = vi.fn().mockResolvedValue([])
    this.readResource = vi.fn().mockResolvedValue([])
  })
  return { McpClient }
})

describe(`createMcpIntegration (mocked)`, () => {
  let workDir: string

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-int-${randomUUID()}`)
    mkdirSync(join(workDir, `.electric-agents`), { recursive: true })
    writeFileSync(
      join(workDir, `.electric-agents`, `mcp.json`),
      JSON.stringify({
        servers: {
          test: { command: `echo`, args: [`hello`] },
        },
      })
    )
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`loads config and bridges tools`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const tools = await mcp.getTools()

    const mcpTools = tools.filter((t) => t.name.startsWith(`mcp__test__`))
    expect(mcpTools).toHaveLength(1)
    expect(mcpTools[0]!.name).toBe(`mcp__test__echo`)

    // Execute the bridged tool
    const result = await mcpTools[0]!.execute(`c1`, { text: `hello` })
    expect((result.content[0] as any).text).toBe(`echo: hello`)

    await mcp.close()
  })

  it(`includes config management tools`, () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const configToolNames = mcp.configTools.map((t) => t.name)
    expect(configToolNames).toContain(`mcp__manage__add_server`)
    expect(configToolNames).toContain(`mcp__manage__remove_server`)
    expect(configToolNames).toContain(`mcp__manage__list_servers`)
    expect(configToolNames).toContain(`mcp__manage__list_tools`)
  })

  it(`generates server summary with instructions`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    await mcp.getTools() // triggers lazy connect
    const summary = await mcp.getServerSummary()
    expect(summary).toContain(`# MCP Servers`)
    expect(summary).toContain(`test`)
    expect(summary).toContain(`mcp__test__echo`)

    await mcp.close()
  })

  it(`applies overrides to exclude servers`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const tools = await mcp.getTools({ test: false })
    const mcpTools = tools.filter((t) => t.name.startsWith(`mcp__test__`))
    expect(mcpTools).toHaveLength(0)

    await mcp.close()
  })
})
