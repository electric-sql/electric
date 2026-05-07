/**
 * BuiltinAgentsServer's MCP wiring: it merges embedder-provided
 * `extraMcpServers` (e.g. desktop's `settings.json` `mcp.servers`)
 * with the project's `mcp.json` (resolved against `workingDirectory`).
 * Both sources contribute non-conflicting servers; on name conflict,
 * `mcp.json` wins.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiltinAgentsServer } from '../src/server'

// The mock streamFn lets the server start without a real API key.
const mockStreamFn = vi.fn(async function* () {}) as any

async function makeWorkspace(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), `agents-mcp-test-`))
}

async function writeMcpJson(
  dir: string,
  body: Record<string, unknown>
): Promise<void> {
  await fs.writeFile(path.join(dir, `mcp.json`), JSON.stringify(body))
}

function namesOf(server: BuiltinAgentsServer): string[] {
  const reg = server.mcpRegistry
  expect(reg).toBeTruthy()
  return reg!.list().map((e) => e.name)
}

// Wait for the registry to settle on the expected names. applyConfig
// is fire-and-forget from the constructor's perspective (HTTPS
// discovery + DCR can take seconds), so a short poll covers the lag.
async function waitForServers(
  server: BuiltinAgentsServer,
  expected: string[],
  timeoutMs = 1500
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const names = namesOf(server).slice().sort()
    const want = expected.slice().sort()
    if (names.length === want.length && names.every((n, i) => n === want[i])) {
      return
    }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(
    `timed out waiting for registry servers; want ${JSON.stringify(expected)} got ${JSON.stringify(namesOf(server))}`
  )
}

describe(`BuiltinAgentsServer — MCP merge`, () => {
  let workspace: string
  let server: BuiltinAgentsServer | null = null

  beforeEach(async () => {
    workspace = await makeWorkspace()
  })

  afterEach(async () => {
    await server?.stop()
    server = null
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {})
  })

  it(`registers extras when no mcp.json is present in the workspace`, async () => {
    server = new BuiltinAgentsServer({
      agentServerUrl: `http://localhost:4437`,
      port: 0,
      mockStreamFn,
      workingDirectory: workspace,
      extraMcpServers: [
        {
          name: `extras-only`,
          transport: `http`,
          url: `https://example.invalid/mcp`,
          auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
        },
      ],
    })
    await server.start()
    await waitForServers(server, [`extras-only`])
  })

  it(`registers mcp.json servers and ignores extras when none provided`, async () => {
    await writeMcpJson(workspace, {
      servers: {
        'workspace-only': {
          transport: `http`,
          url: `https://example.invalid/mcp`,
          auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
        },
      },
    })
    server = new BuiltinAgentsServer({
      agentServerUrl: `http://localhost:4437`,
      port: 0,
      mockStreamFn,
      workingDirectory: workspace,
    })
    await server.start()
    await waitForServers(server, [`workspace-only`])
  })

  it(`merges non-conflicting servers from both sources`, async () => {
    await writeMcpJson(workspace, {
      servers: {
        'from-workspace': {
          transport: `http`,
          url: `https://example.invalid/mcp`,
          auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
        },
      },
    })
    server = new BuiltinAgentsServer({
      agentServerUrl: `http://localhost:4437`,
      port: 0,
      mockStreamFn,
      workingDirectory: workspace,
      extraMcpServers: [
        {
          name: `from-settings`,
          transport: `http`,
          url: `https://example.invalid/mcp`,
          auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
        },
      ],
    })
    await server.start()
    await waitForServers(server, [`from-settings`, `from-workspace`])
  })

  it(`workspace mcp.json wins on name conflict`, async () => {
    await writeMcpJson(workspace, {
      servers: {
        'shared-name': {
          transport: `http`,
          url: `https://workspace.invalid/mcp`,
          auth: { mode: `apiKey`, key: `wk`, headerName: `X-Workspace` },
        },
      },
    })
    server = new BuiltinAgentsServer({
      agentServerUrl: `http://localhost:4437`,
      port: 0,
      mockStreamFn,
      workingDirectory: workspace,
      extraMcpServers: [
        {
          name: `shared-name`,
          transport: `http`,
          url: `https://settings.invalid/mcp`,
          auth: { mode: `apiKey`, key: `sk`, headerName: `X-Settings` },
        },
      ],
    })
    await server.start()
    await waitForServers(server, [`shared-name`])
    const entry = server.mcpRegistry!.get(`shared-name`)
    expect(entry?.config.transport).toBe(`http`)
    if (entry?.config.transport === `http`) {
      expect(entry.config.url).toBe(`https://workspace.invalid/mcp`)
    }
  })
})
