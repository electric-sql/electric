import type { AgentTool } from '@mariozechner/pi-agent-core'
import { McpClient } from './client.js'
import type {
  McpConfig,
  McpOverrides,
  McpServerConfig,
  McpServerState,
  McpServerStatus,
} from './types.js'
import { MCP_DEFAULTS } from './types.js'
import { TokenStore } from './auth/token-store.js'
import { bridgeMcpTools } from './bridge/tool-bridge.js'
import { createResourceTools } from './bridge/resource-bridge.js'

// ── Pool entry ─────────────────────────────────────────────

interface PoolEntry {
  config: McpServerConfig
  client?: McpClient
  status: McpServerStatus
  idleTimer?: ReturnType<typeof setTimeout>
  error?: string
}

// ── Options ────────────────────────────────────────────────

export interface McpClientPoolOptions {
  workingDirectory: string
  onAuthUrl?: (url: string) => void
}

// ── McpClientPool ──────────────────────────────────────────

export class McpClientPool {
  private readonly entries: Map<string, PoolEntry> = new Map()
  private readonly tokenStore: TokenStore
  private readonly workingDirectory: string
  private readonly onAuthUrl?: (url: string) => void

  constructor(config: McpConfig, options: McpClientPoolOptions) {
    this.workingDirectory = options.workingDirectory
    this.onAuthUrl = options.onAuthUrl
    this.tokenStore = new TokenStore(this.workingDirectory)

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      this.entries.set(name, {
        config: serverConfig,
        status: `idle`,
      })
    }
  }

  // ── Acquire / Release ──────────────────────────────────────

  async acquire(serverName: string): Promise<McpClient> {
    const entry = this.entries.get(serverName)
    if (!entry) {
      throw new Error(`Unknown MCP server: "${serverName}"`)
    }
    if (entry.config.enabled === false) {
      throw new Error(`MCP server "${serverName}" is disabled`)
    }

    // Clear idle timer
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }

    // Return existing connected client
    if (entry.client && entry.status === `connected`) {
      return entry.client
    }

    // Create and connect
    entry.status = `connecting`
    try {
      const client = new McpClient({
        serverName,
        config: entry.config,
        tokenStore: this.tokenStore,
        workingDirectory: this.workingDirectory,
        onAuthUrl: this.onAuthUrl,
      })

      await client.connect()

      entry.client = client
      entry.status = `connected`
      return client
    } catch (err) {
      entry.status = `failed`
      entry.error = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  release(serverName: string): void {
    const entry = this.entries.get(serverName)
    if (!entry || !entry.client) return

    const idleTimeout = entry.config.idleTimeoutMs ?? MCP_DEFAULTS.idleTimeoutMs

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }

    entry.idleTimer = setTimeout(async () => {
      await this.disconnectEntry(serverName, entry)
    }, idleTimeout)
  }

  // ── Tools ──────────────────────────────────────────────────

  async getTools(overrides?: McpOverrides): Promise<AgentTool[]> {
    const allTools: AgentTool[] = []
    const effectiveServers = this.resolveOverrides(overrides)

    for (const { name, config } of effectiveServers) {
      try {
        const client = await this.acquire(name)
        const tools = bridgeMcpTools(name, client.tools, this, config)
        allTools.push(...tools)
        this.release(name)
      } catch {
        // Server unavailable, skip its tools
      }
    }

    // Add resource tools
    allTools.push(...createResourceTools(this))

    return allTools
  }

  // ── Server info ────────────────────────────────────────────

  getEnabledServers(): Array<{ name: string; config: McpServerConfig }> {
    const result: Array<{ name: string; config: McpServerConfig }> = []
    for (const [name, entry] of this.entries) {
      if (entry.config.enabled !== false) {
        result.push({ name, config: entry.config })
      }
    }
    return result
  }

  getServerStatus(serverName: string): McpServerStatus {
    const entry = this.entries.get(serverName)
    return entry?.status ?? `idle`
  }

  getServerStates(): McpServerState[] {
    const states: McpServerState[] = []
    for (const [name, entry] of this.entries) {
      states.push({
        name,
        config: entry.config,
        status: entry.status,
        tools: entry.client?.tools ?? [],
        resources: entry.client?.resources ?? [],
        instructions: entry.client?.instructions,
        error: entry.error,
        sessionId: entry.client?.sessionId,
        protocolVersion: entry.client?.protocolVersion,
      })
    }
    return states
  }

  getInstructions(): Record<string, string> {
    const instructions: Record<string, string> = {}
    for (const [name, entry] of this.entries) {
      if (entry.client?.instructions) {
        instructions[name] = entry.client.instructions
      }
    }
    return instructions
  }

  // ── Dynamic config ─────────────────────────────────────────

  addServer(name: string, config: McpServerConfig): void {
    this.entries.set(name, {
      config,
      status: `idle`,
    })
  }

  async removeServer(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (entry) {
      await this.disconnectEntry(name, entry)
      this.entries.delete(name)
    }
  }

  // ── Close ──────────────────────────────────────────────────

  async close(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [name, entry] of this.entries) {
      promises.push(this.disconnectEntry(name, entry))
    }
    await Promise.all(promises)
  }

  // ── Private helpers ────────────────────────────────────────

  private async disconnectEntry(name: string, entry: PoolEntry): Promise<void> {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }
    if (entry.client) {
      try {
        await entry.client.close()
      } catch {
        // ignore errors during close
      }
      entry.client = undefined
    }
    entry.status = `idle`
    entry.error = undefined
  }

  private resolveOverrides(
    overrides?: McpOverrides
  ): Array<{ name: string; config: McpServerConfig }> {
    const result: Array<{ name: string; config: McpServerConfig }> = []

    // Start with enabled servers from base config
    for (const [name, entry] of this.entries) {
      if (overrides && name in overrides) {
        const override = overrides[name]
        if (override === false) continue // Disabled by override
        // Merge override config
        result.push({ name, config: { ...entry.config, ...override } })
      } else if (entry.config.enabled !== false) {
        result.push({ name, config: entry.config })
      }
    }

    // Add new servers from overrides that don't exist in base config
    if (overrides) {
      for (const [name, override] of Object.entries(overrides)) {
        if (override === false) continue
        if (!this.entries.has(name)) {
          // Dynamically add the server
          this.addServer(name, override)
          result.push({ name, config: override })
        }
      }
    }

    return result
  }
}
