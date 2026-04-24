# MCP Server Support for Electric Agents

**Date:** 2026-04-24
**Status:** Approved (revised after Claude Code & Codex CLI comparison)

## Goal

Add MCP (Model Context Protocol) server support so entities can use remote and local MCP servers the same way they use built-in tools. Cover tools, resources, OAuth auth flow, stdio and Streamable HTTP transports.

## Approach

New package `@electric-ax/agents-mcp` that plugs into `agents-runtime` via the existing `AgentTool` interface. The runtime stays MCP-agnostic; MCP is opt-in.

## Package Structure

```
packages/agents-mcp/
├── package.json          # @electric-ax/agents-mcp
├── tsconfig.json
├── src/
│   ├── index.ts          # Public exports
│   ├── types.ts          # Config types, MCP server definitions
│   ├── pool.ts           # McpClientPool — connection lifecycle + idle timeout
│   ├── client.ts         # McpClient — wraps a single MCP server connection
│   ├── transports/
│   │   ├── stdio.ts      # Stdio transport (spawn child process)
│   │   └── streamable-http.ts  # Streamable HTTP transport
│   ├── auth/
│   │   ├── oauth.ts      # OAuth 2.1 + PKCE flow via SDK's OAuthClientProvider
│   │   └── token-store.ts     # Token persistence (.electric-agents/mcp-auth.json)
│   ├── bridge/
│   │   ├── tool-bridge.ts     # MCP Tool -> AgentTool adapter
│   │   └── resource-bridge.ts # MCP Resource -> read tools
│   ├── config/
│   │   ├── config-store.ts    # Read/write .electric-agents/mcp.json
│   │   ├── config-tools.ts    # AgentTools for Horton to manage MCP config
│   │   └── env-expand.ts      # ${VAR} and ${VAR:-default} expansion
│   └── integration.ts   # createMcpIntegration() factory
```

### Dependencies

- `@modelcontextprotocol/sdk` — official MCP TypeScript SDK (Client, transports, types, auth)
- `@electric-ax/agents-runtime` — peer dependency for `AgentTool` type

## Configuration

### Global config: `.electric-agents/mcp.json`

Supports `${VAR}` and `${VAR:-default}` environment variable expansion in `command`, `args`, `env`, `url`, and `headers` values.

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    },
    "honeycomb": {
      "url": "https://api.honeycomb.io/mcp",
      "auth": "oauth",
      "oauth": {
        "scopes": ["read:data", "write:annotations"]
      }
    },
    "internal-api": {
      "url": "https://internal.example.com/mcp",
      "auth": { "tokenEnvVar": "INTERNAL_API_KEY" },
      "headers": { "X-Team": "platform" }
    }
  }
}
```

### Auth tokens: `.electric-agents/mcp-auth.json` (gitignored)

```json
{
  "honeycomb": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1719500000,
    "token_type": "Bearer"
  }
}
```

### File conventions

- `.electric-agents/mcp.json` — server config (can be committed if secrets use env var refs)
- `.electric-agents/mcp-auth.json` — tokens/secrets (gitignored)
- `.electric-agents/.gitignore` — auto-created with `mcp-auth.json` entry

### Per-entity-instance overrides

Overrides are passed via spawn args:

```ts
ctx.spawn('horton', 'my-agent', {
  mcpServers: {
    github: false,                    // disable globally-configured server
    honeycomb: { url: 'https://...' } // add instance-specific server
  }
})
```

The handler reads `ctx.args.mcpServers` and passes it as `McpOverrides` to `mcp.getTools(overrides)`.

## Types

```ts
interface McpServerConfig {
  /** Stdio transport */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string                    // working directory for stdio process

  /** Streamable HTTP transport */
  url?: string

  /** Auth */
  auth?: 'oauth' | { token: string } | { tokenEnvVar: string }
  headers?: Record<string, string>       // arbitrary static headers (env-expandable)

  /** OAuth specifics (only when auth: 'oauth') */
  oauth?: {
    clientId?: string             // optional if server supports DCR
    scopes?: string[]
    callbackPort?: number
  }

  /** Lifecycle */
  enabled?: boolean               // toggle without removing config (default: true)
  startupTimeoutMs?: number       // connection timeout (default: 10_000)
  toolTimeoutMs?: number          // per-tool-call timeout (default: 60_000)
  idleTimeoutMs?: number          // idle before disconnect (default: 300_000)
  maxOutputChars?: number         // cap tool output size (default: 25_000)
}

interface McpConfig {
  servers: Record<string, McpServerConfig>
}

type McpOverrides = Record<string, false | McpServerConfig>
```

## McpClient

Thin wrapper around `@modelcontextprotocol/sdk`'s `Client` class. Adds:

- Transport-agnostic construction (pass config, get a connected client)
- Implements SDK's `OAuthClientProvider` interface for OAuth auth (backed by token-store)
- Typed accessors for `listTools()`, `callTool()`, `listResources()`, `readResource()`
- Stores `sessionId` and `protocolVersion` for efficient reconnection

This is not a significant abstraction — it exists to keep transport setup and auth handling out of the pool.

## MCP Client Pool

Manages lazy connection lifecycle with idle timeout.

```ts
class McpClientPool {
  constructor(config: McpConfig, opts: { workingDirectory: string })
  acquire(serverName: string): Promise<McpClient>
  release(serverName: string): void
  getTools(filter?: { servers?: string[] }): Promise<AgentTool[]>
  getResources(filter?: { servers?: string[] }): Promise<McpResource[]>
  getServerInstructions(): Record<string, string>
  reload(): Promise<void>
  close(): Promise<void>
}
```

### Connection lifecycle

1. `idle` — no connection, no process
2. `acquire()` — triggers connect (spawn process / HTTP connect)
3. `connecting` — transport initializing, capability negotiation, tool/resource discovery
4. `connected` — ready for tool calls and resource reads
5. `release()` — starts idle timer
6. Idle timer expires — disconnect (kill process / drop HTTP)
7. Next `acquire()` — reconnect transparently

### Reconnection strategy

- On connection failure during `acquire()`, use exponential backoff: 5 attempts, 1s base delay, 2x growth, 30s max delay.
- For stdio: process crash detected via `onclose` callback — mark as disconnected, reconnect on next `acquire()`.
- For Streamable HTTP: store `sessionId` and `protocolVersion` — pass to new transport on reconnect to skip re-initialization. If server returns 404 (session expired), do full re-init.

### Graceful stdio shutdown

Follow the MCP SDK pattern: close stdin → wait 2s → SIGTERM → wait 2s → SIGKILL.

### Notifications

Use the SDK's `listChanged` constructor option for automatic re-discovery:

```ts
new Client(clientInfo, {
  listChanged: {
    tools: { onChanged: (err, tools) => { /* update cached tools */ } },
    resources: { onChanged: (err, resources) => { /* update cached resources */ } },
  }
})
```

### Output size limiting

Tool call results exceeding `maxOutputChars` (default: 25,000) are truncated with a notice appended: `[Output truncated at 25000 chars. Original size: N chars]`.

## Transports

### Stdio

- Spawns child process with `command` + `args` via SDK's `StdioClientTransport`
- `env` merged with `process.env` + `{ HOME: workingDirectory }`
- `cwd` defaults to `workingDirectory` if not specified
- Process killed on disconnect (graceful shutdown sequence), respawned on reconnect
- `startupTimeoutMs` applied as AbortSignal timeout on `client.connect()`

### Streamable HTTP

- Uses SDK's `StreamableHTTPClientTransport`
- Auth via SDK's `AuthProvider` interface — `token()` reads from token store, `onUnauthorized()` triggers OAuth flow
- `headers` from config passed via `requestInit`
- SDK handles `mcp-session-id` and `mcp-protocol-version` headers automatically
- Built-in SSE reconnection with exponential backoff (SDK-provided)

## Auth Flow (OAuth 2.1 + PKCE)

Implemented via the MCP SDK's `OAuthClientProvider` interface backed by our token store.

### OAuthClientProvider implementation

```ts
class ElectricOAuthProvider implements OAuthClientProvider {
  // Reads/writes .electric-agents/mcp-auth.json
  tokens(): Promise<OAuthTokens | undefined>
  saveTokens(tokens: OAuthTokens): Promise<void>

  // Stores code verifier for PKCE
  saveCodeVerifier(verifier: string): Promise<void>
  codeVerifier(): Promise<string>

  // Client registration (supports DCR if server allows)
  clientInformation(): Promise<OAuthClientInformation | undefined>
  saveClientInformation(info: OAuthClientInformation): Promise<void>

  // Auth redirect — starts local HTTP server, prints URL
  redirectToAuthorization(authUrl: URL): Promise<void>
}
```

### Flow

1. `acquire()` calls `client.connect(transport)` with our `OAuthClientProvider`
2. On 401, SDK calls `redirectToAuthorization(authUrl)`
3. Our implementation starts a temporary local HTTP server on `oauth.callbackPort` (or random port)
4. Auth URL printed to logs. If Horton triggered it via `mcp_add_server`, returned as tool result
5. User authorizes in browser → redirect to local callback → SDK exchanges code for tokens
6. `saveTokens()` persists to `.electric-agents/mcp-auth.json`
7. SDK retries the connection with the new token
8. Auto-refresh handled by SDK — calls `tokens()` before each request

### Static token auth

For servers with `auth: { token: "..." }` or `auth: { tokenEnvVar: "VAR" }`, use a simple `AuthProvider`:

```ts
{ token: async () => resolvedToken }
```

No OAuth flow needed.

## Tool Bridge

MCP tools are adapted to the `AgentTool` interface (from `@mariozechner/pi-agent-core`).

### Namespacing

Tools are prefixed with `mcp__` + server name: `mcp__github__create_issue`, `mcp__honeycomb__query`. This matches the Claude Code convention and distinguishes MCP tools from built-in tools. The prefix is stripped before forwarding calls to the MCP server.

### Adapter

```ts
function bridgeMcpTool(serverName: string, mcpTool: MCP.Tool, pool: McpClientPool, config: McpServerConfig): AgentTool {
  return {
    name: `mcp__${serverName}__${mcpTool.name}`,
    label: mcpTool.name,
    description: mcpTool.description ?? '',
    parameters: mcpTool.inputSchema,
    execute: async (_toolCallId, params) => {
      const client = await pool.acquire(serverName)
      try {
        const result = await client.callTool(mcpTool.name, params, {
          timeout: config.toolTimeoutMs ?? 60_000,
        })
        const output = formatMcpResult(result)
        return truncateOutput(output, config.maxOutputChars ?? 25_000)
      } finally {
        pool.release(serverName)
      }
    },
  }
}
```

## Resource Bridge

Resources are exposed as tools rather than eagerly loaded into context (resources can be large and numerous).

### Tools

- **`mcp__list_resources`** — lists all resources from connected MCP servers with URIs and descriptions
- **`mcp__read_resource`** — reads a specific resource by server name + URI

This lets the agent decide when to read resources, avoiding context bloat.

## Config Management Tools (for Horton)

Tools added to Horton's tool array so users can configure MCP servers conversationally:

- **`mcp__manage__add_server`** — adds an MCP server to `.electric-agents/mcp.json`. Takes `name`, transport config (`command`/`url`), `auth`. Triggers pool connection + OAuth if needed. Returns success or auth URL.
- **`mcp__manage__remove_server`** — removes a server from config, disconnects from pool.
- **`mcp__manage__list_servers`** — lists configured servers with connection status.
- **`mcp__manage__list_tools`** — lists all tools from connected MCP servers (or filter by server).

## Integration Wiring

### Main export from `@electric-ax/agents-mcp`

```ts
function createMcpIntegration(opts: {
  workingDirectory: string
}): McpIntegration

interface McpIntegration {
  /** Tools for managing MCP config (for Horton) */
  configTools: AgentTool[]
  /** Get all bridged MCP tools for an entity, applying overrides */
  getTools(overrides?: McpOverrides): Promise<AgentTool[]>
  /** Get server instructions for system prompt injection */
  getServerInstructions(): Record<string, string>
  /** Pool access for resource reads */
  pool: McpClientPool
  /** Shut down */
  close(): Promise<void>
}
```

### Bootstrap wiring in `packages/agents`

```ts
// bootstrap.ts
import { createMcpIntegration } from '@electric-ax/agents-mcp'

const mcp = createMcpIntegration({ workingDirectory: cwd })

// In Horton's handler:
const tools = [
  ...ctx.electricTools,
  ...createHortonTools(workingDirectory, ctx, readSet),
  ...mcp.configTools,
  ...(await mcp.getTools()),
]
```

### Per-instance override wiring

```ts
// In entity handler:
const overrides = ctx.args.mcpServers as McpOverrides | undefined
const mcpTools = await mcp.getTools(overrides)
```

## System Prompt Injection

Connected MCP servers are summarized dynamically in the agent's system prompt. Two sources of information:

### Server instructions

MCP servers can provide instructions during initialization (`client.getInstructions()`). These are included in the system prompt to help the agent understand server-specific guidance.

### Tool summary

```
# MCP Servers
The following external tool servers are connected:

## honeycomb
Instructions: Use natural language time ranges like "last 2 hours".
Tools: mcp__honeycomb__query, mcp__honeycomb__list_datasets, ...

## github
Tools: mcp__github__create_issue, mcp__github__search_repos, ...

Use mcp__list_resources to discover available resources from these servers.
```

Generated from the pool's discovered tools and instructions at handler time.

## Error Handling

- **Connection failures** — logged, exponential backoff retry (5 attempts). Tools from that server excluded from the entity's tool set until reconnected.
- **Startup timeout** — `startupTimeoutMs` (default: 10s) applied via AbortSignal. Server marked as failed if exceeded.
- **Auth failures** — if stored tokens are expired and refresh fails, tool calls return an error asking the user to re-authenticate via `mcp__manage__add_server`.
- **Tool call failures** — MCP errors passed through as `isError: true` in the tool result. The agent can retry or report to the user.
- **Tool call timeout** — `toolTimeoutMs` (default: 60s) applied via AbortSignal on each `callTool()`.
- **Output overflow** — results exceeding `maxOutputChars` are truncated with notice.
- **Process crashes (stdio)** — pool detects process exit via `onclose`, marks server as disconnected, reconnects with backoff on next `acquire()`.
- **Env var expansion failures** — missing required env vars (no default) cause a config load error with clear message naming the missing variable.

## Scope Boundaries

### In scope

- Stdio and Streamable HTTP transports
- Tools and Resources
- OAuth 2.1 + PKCE auth flow via SDK's OAuthClientProvider (including DCR support)
- Connection pooling with idle timeout and exponential backoff reconnection
- Config management via Horton tools
- Per-entity-instance overrides
- Tool namespacing (`mcp__server__tool`)
- Dynamic tool/resource list change notifications
- Environment variable expansion in config
- Server instructions in system prompt
- Output size limiting
- Configurable startup and tool call timeouts
- Graceful stdio shutdown
- `enabled` toggle per server

### Out of scope (future work)

- SSE transport (deprecated in MCP spec)
- MCP Prompts capability
- MCP Sampling capability (reverse LLM calls)
- Exposing entities as MCP servers
- `headersHelper` (shell command for dynamic header generation)
- Tool deferred loading / search (load tool schemas on demand)
- System keychain for token storage (currently file-based)
- DCR (Dynamic Client Registration) — SDK supports it; we pass through but don't configure
