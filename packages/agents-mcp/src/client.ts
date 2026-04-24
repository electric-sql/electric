import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpServerConfig,
  McpDiscoveredTool,
  McpDiscoveredResource,
} from './types.js'
import { MCP_DEFAULTS } from './types.js'
import { TokenStore } from './auth/token-store.js'
import { McpOAuthProvider } from './auth/oauth-provider.js'
import { expandConfigValues } from './config/env-expand.js'

// ── Public types ──────────────────────────────────────────────

export interface McpClientOptions {
  serverName: string
  config: McpServerConfig
  tokenStore: TokenStore
  workingDirectory: string
  onAuthUrl?: (url: string) => void
  onToolsChanged?: (tools: McpDiscoveredTool[]) => void
  onResourcesChanged?: (resources: McpDiscoveredResource[]) => void
}

// ── McpClient ─────────────────────────────────────────────────

export class McpClient {
  private readonly serverName: string
  private readonly config: McpServerConfig
  private readonly tokenStore: TokenStore
  private readonly workingDirectory: string
  private readonly onAuthUrl?: (url: string) => void
  private readonly onToolsChanged?: (tools: McpDiscoveredTool[]) => void
  private readonly onResourcesChanged?: (
    resources: McpDiscoveredResource[]
  ) => void

  private client?: Client
  private transport?: Transport

  private _tools: McpDiscoveredTool[] = []
  private _resources: McpDiscoveredResource[] = []
  private _sessionId?: string
  private _protocolVersion?: string
  private _instructions?: string

  constructor(opts: McpClientOptions) {
    this.serverName = opts.serverName
    this.config = opts.config
    this.tokenStore = opts.tokenStore
    this.workingDirectory = opts.workingDirectory
    this.onAuthUrl = opts.onAuthUrl
    this.onToolsChanged = opts.onToolsChanged
    this.onResourcesChanged = opts.onResourcesChanged
  }

  // ── Accessors ───────────────────────────────────────────────

  get tools(): McpDiscoveredTool[] {
    return this._tools
  }

  get resources(): McpDiscoveredResource[] {
    return this._resources
  }

  get sessionId(): string | undefined {
    return this._sessionId
  }

  get protocolVersion(): string | undefined {
    return this._protocolVersion
  }

  get instructions(): string | undefined {
    return this._instructions
  }

  // ── Connect ─────────────────────────────────────────────────

  async connect(): Promise<void> {
    const timeoutMs =
      this.config.startupTimeoutMs ?? MCP_DEFAULTS.startupTimeoutMs

    this.transport = this.createTransport()

    this.client = new Client(
      { name: `electric-agents`, version: `0.0.1` },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_err, items) => {
              if (items) {
                this._tools = items.map(mapTool)
                this.onToolsChanged?.(this._tools)
              }
            },
          },
          resources: {
            onChanged: (_err, items) => {
              if (items) {
                this._resources = items.map(mapResource)
                this.onResourcesChanged?.(this._resources)
              }
            },
          },
        },
      }
    )

    await this.client.connect(this.transport, {
      timeout: timeoutMs,
    })

    // Capture session metadata
    const serverVersion = this.client.getServerVersion()
    this._protocolVersion = serverVersion?.version
    this._instructions = this.client.getInstructions()

    // Capture sessionId from the transport (StreamableHTTP only)
    if (this.transport instanceof StreamableHTTPClientTransport) {
      this._sessionId = this.transport.sessionId
    }

    // Initial discovery
    await this.discoverCapabilities()
  }

  // ── Discovery ───────────────────────────────────────────────

  private async discoverCapabilities(): Promise<void> {
    const caps = this.client?.getServerCapabilities()

    if (caps?.tools) {
      const result = await this.client!.listTools()
      this._tools = result.tools.map(mapTool)
    }

    if (caps?.resources) {
      const result = await this.client!.listResources()
      this._resources = result.resources.map(mapResource)
    }
  }

  // ── Tool calling ────────────────────────────────────────────

  async callTool(
    name: string,
    args?: Record<string, unknown>
  ): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>
    isError?: boolean
  }> {
    if (!this.client) {
      throw new Error(`Client not connected to MCP server "${this.serverName}"`)
    }

    const timeoutMs = this.config.toolTimeoutMs ?? MCP_DEFAULTS.toolTimeoutMs

    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: timeoutMs }
    )

    return result as {
      content: Array<{ type: string; text?: string; [key: string]: unknown }>
      isError?: boolean
    }
  }

  // ── Resources ───────────────────────────────────────────────

  async listResources(): Promise<McpDiscoveredResource[]> {
    if (!this.client) {
      throw new Error(`Client not connected to MCP server "${this.serverName}"`)
    }
    const result = await this.client.listResources()
    this._resources = result.resources.map(mapResource)
    return this._resources
  }

  async readResource(uri: string): Promise<
    Array<{
      uri: string
      text?: string
      blob?: string
      mimeType?: string
    }>
  > {
    if (!this.client) {
      throw new Error(`Client not connected to MCP server "${this.serverName}"`)
    }
    const result = await this.client.readResource({ uri })
    return result.contents as Array<{
      uri: string
      text?: string
      blob?: string
      mimeType?: string
    }>
  }

  // ── Close ───────────────────────────────────────────────────

  async close(): Promise<void> {
    try {
      await this.client?.close()
    } catch {
      // ignore errors during close
    }
    this.client = undefined
    this.transport = undefined
    this._tools = []
    this._resources = []
    this._sessionId = undefined
  }

  // ── Transport creation ──────────────────────────────────────

  private createTransport(): Transport {
    if (this.config.command) {
      return this.createStdioTransport()
    }
    if (this.config.url) {
      return this.createHttpTransport()
    }
    throw new Error(
      `MCP server "${this.serverName}" must specify either "command" (stdio) or "url" (HTTP)`
    )
  }

  private createStdioTransport(): StdioClientTransport {
    const expanded = expandConfigValues(
      {
        command: this.config.command!,
        args: this.config.args,
        env: this.config.env,
      },
      process.env as Record<string, string>
    )

    return new StdioClientTransport({
      command: expanded.command,
      args: expanded.args,
      env: {
        ...process.env,
        ...expanded.env,
      } as Record<string, string>,
      cwd: this.config.cwd ?? this.workingDirectory,
    })
  }

  private createHttpTransport(): StreamableHTTPClientTransport {
    const url = new URL(this.config.url!)

    const opts: {
      authProvider?: McpOAuthProvider
      requestInit?: RequestInit
      sessionId?: string
    } = {}

    // Restore previous sessionId for reconnection
    if (this._sessionId) {
      opts.sessionId = this._sessionId
    }

    // ── Auth wiring ───────────────────────────────────────────

    if (this.config.auth === `oauth`) {
      opts.authProvider = new McpOAuthProvider({
        serverName: this.serverName,
        serverConfig: this.config,
        tokenStore: this.tokenStore,
        onAuthUrl: this.onAuthUrl,
      })
    } else {
      // Build static headers for Bearer token or custom headers
      const headers = this.buildStaticHeaders()
      if (Object.keys(headers).length > 0) {
        opts.requestInit = { headers }
      }
    }

    return new StreamableHTTPClientTransport(url, opts)
  }

  private buildStaticHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}

    // Static token auth
    if (this.config.auth && typeof this.config.auth === `object`) {
      let token: string | undefined

      if (`token` in this.config.auth) {
        token = this.config.auth.token
      } else if (`tokenEnvVar` in this.config.auth) {
        token = process.env[this.config.auth.tokenEnvVar]
        if (!token) {
          throw new Error(
            `Environment variable "${this.config.auth.tokenEnvVar}" is not set for MCP server "${this.serverName}"`
          )
        }
      }

      if (token) {
        headers[`Authorization`] = `Bearer ${token}`
      }
    }

    // Custom headers with env var expansion
    if (this.config.headers) {
      const expanded = expandConfigValues(
        this.config.headers,
        process.env as Record<string, string>
      )
      Object.assign(headers, expanded)
    }

    return headers
  }
}

// ── Helpers ───────────────────────────────────────────────────

function mapTool(tool: {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}): McpDiscoveredTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }
}

function mapResource(resource: {
  uri: string
  name: string
  description?: string
  mimeType?: string
}): McpDiscoveredResource {
  return {
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
  }
}
