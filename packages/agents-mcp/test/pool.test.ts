import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock(`../src/client`, () => {
  const McpClient = vi.fn().mockImplementation(function (this: any, opts: any) {
    this.serverName = opts.serverName
    this.tools = []
    this.resources = []
    this.instructions = undefined
    this.connect = vi.fn().mockResolvedValue(undefined)
    this.discover = vi.fn().mockResolvedValue(undefined)
    this.close = vi.fn().mockResolvedValue(undefined)
    this.callTool = vi.fn()
    this.listResources = vi.fn().mockResolvedValue([])
    this.readResource = vi.fn().mockResolvedValue([])
  })
  return { McpClient }
})

import { McpClientPool } from '../src/pool'
import type { McpConfig } from '../src/types'

describe(`McpClientPool`, () => {
  const config: McpConfig = {
    servers: {
      test: { command: `echo`, args: [`hello`], enabled: true },
      disabled: { command: `echo`, enabled: false },
    },
  }

  let pool: McpClientPool

  beforeEach(() => {
    pool = new McpClientPool(config, { workingDirectory: `/tmp` })
  })

  it(`creates a client on first acquire`, async () => {
    const client = await pool.acquire(`test`)
    expect(client).toBeDefined()
    expect((client as any).serverName).toBe(`test`)
  })

  it(`returns the same client on second acquire`, async () => {
    const first = await pool.acquire(`test`)
    const second = await pool.acquire(`test`)
    expect(first).toBe(second)
  })

  it(`throws for unknown server`, async () => {
    await expect(pool.acquire(`unknown`)).rejects.toThrow(/unknown/)
  })

  it(`throws for disabled server`, async () => {
    await expect(pool.acquire(`disabled`)).rejects.toThrow(/disabled/)
  })

  it(`getServerStatus returns idle for unconnected, connected after acquire`, async () => {
    expect(pool.getServerStatus(`test`)).toBe(`idle`)
    await pool.acquire(`test`)
    expect(pool.getServerStatus(`test`)).toBe(`connected`)
  })

  it(`close disconnects all clients`, async () => {
    await pool.acquire(`test`)
    await pool.close()
    expect(pool.getServerStatus(`test`)).toBe(`idle`)
  })

  it(`getEnabledServers excludes disabled servers`, () => {
    const enabled = pool.getEnabledServers()
    expect(enabled.map((s) => s.name)).toEqual([`test`])
  })
})
