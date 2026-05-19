/**
 * BuiltinAgentsServer's MCP wiring: it merges embedder-provided
 * `extraMcpServers` (e.g. desktop's `settings.json` `mcp.servers`)
 * with the project's `mcp.json` (resolved against `workingDirectory`).
 * Both sources contribute non-conflicting servers; on name conflict,
 * `mcp.json` wins.
 */

import { createServer, type Server } from 'node:http'
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

// Minimal stand-in for an agents-server. BuiltinAgentsServer.start()
// POSTs entity-type registration during bootstrap; CI has nothing
// listening on a fixed port, so we spin up a no-op HTTP server that
// 200s every request and feed its URL through `agentServerUrl`.
async function startMockAgentsServer(): Promise<{
  url: string
  stop: () => Promise<void>
}> {
  const httpServer: Server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': `application/json` })
    res.end(`{}`)
  })
  await new Promise<void>((resolve) =>
    httpServer.listen(0, `127.0.0.1`, resolve)
  )
  const addr = httpServer.address()
  if (!addr || typeof addr === `string`) {
    throw new Error(`mock agents-server failed to bind`)
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      ),
  }
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
  let mockServer: { url: string; stop: () => Promise<void> }

  beforeEach(async () => {
    workspace = await makeWorkspace()
    mockServer = await startMockAgentsServer()
  })

  afterEach(async () => {
    await server?.stop()
    server = null
    await mockServer.stop().catch(() => {})
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {})
  })

  it(`registers extras when no mcp.json is present in the workspace`, async () => {
    server = new BuiltinAgentsServer({
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
      mockStreamFn,
      workingDirectory: workspace,
      loadProjectMcpConfig: true,
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
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
      mockStreamFn,
      workingDirectory: workspace,
      loadProjectMcpConfig: true,
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
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
      mockStreamFn,
      workingDirectory: workspace,
      loadProjectMcpConfig: true,
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
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
      mockStreamFn,
      workingDirectory: workspace,
      loadProjectMcpConfig: true,
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

  it(`ignores workspace mcp.json by default (no opt-in)`, async () => {
    // Stdio MCP servers can spawn local commands, so picking a working
    // directory must not auto-execute config from it. Without
    // loadProjectMcpConfig, mcp.json is not read or watched.
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
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
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
    await waitForServers(server, [`from-settings`])
    expect(server.mcpRegistry!.get(`workspace-only`)).toBeUndefined()
  })

  it(`stop() tears down MCP registry, watcher, and tool provider`, async () => {
    await writeMcpJson(workspace, {
      servers: {
        teardown: {
          transport: `http`,
          url: `https://example.invalid/mcp`,
          auth: { mode: `apiKey`, key: `k`, headerName: `X-Api-Key` },
        },
      },
    })
    server = new BuiltinAgentsServer({
      agentServerUrl: mockServer.url,
      pullWake: { runnerId: `test-runner` },
      mcpAllowlist: `*`,
      mockStreamFn,
      workingDirectory: workspace,
      loadProjectMcpConfig: true,
    })
    await server.start()
    await waitForServers(server, [`teardown`])
    expect(server.mcpRegistry).not.toBeNull()

    await server.stop()
    // mcpRegistry getter is cleared after teardown so embedders can
    // detect a stopped runtime without holding a stale reference.
    expect(server.mcpRegistry).toBeNull()

    // A second stop() must be a no-op (idempotent), even though the
    // registry / watcher / tool provider were already disposed.
    await expect(server.stop()).resolves.toBeUndefined()

    // Calling start() again should succeed — proving no global state
    // (tool provider, registry slot) was left behind that would clash.
    await server.start()
    expect(server.mcpRegistry).not.toBeNull()
    await waitForServers(server, [`teardown`])
  })
})
