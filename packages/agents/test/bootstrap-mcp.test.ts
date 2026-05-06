/**
 * Smoke test: MCP HTTP endpoints are reachable after BuiltinAgentsServer starts.
 *
 * This test starts the server with a mock streamFn to bypass the model API key
 * requirement, then checks that GET /api/mcp/servers returns { servers: [] }
 * when no mcp.json is present.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuiltinAgentsServer } from '../src/server'

// The mock streamFn lets the server start without a real API key.
const mockStreamFn = vi.fn(async function* () {}) as any

describe(`MCP bootstrap smoke test`, () => {
  let server: BuiltinAgentsServer | null = null
  let serverUrl: string

  beforeEach(async () => {
    server = new BuiltinAgentsServer({
      agentServerUrl: `http://localhost:4437`,
      port: 0, // let the OS pick a free port
      mockStreamFn,
    })
    serverUrl = await server.start()
  })

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  it(`GET /api/mcp/servers returns an empty list when no mcp.json is present`, async () => {
    const res = await fetch(`${serverUrl}/api/mcp/servers`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { servers: unknown[] }
    expect(body).toHaveProperty(`servers`)
    expect(Array.isArray(body.servers)).toBe(true)
    // No mcp.json in the test working directory → empty list.
    expect(body.servers).toHaveLength(0)
  })
})
