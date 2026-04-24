# MCP Server Support for Electric Agents

**Date:** 2026-04-24
**Status:** Approved

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
│   │   ├── oauth.ts      # OAuth 2.1 + PKCE flow
│   │   └── token-store.ts     # Token persistence
│   ├── bridge/
│   │   ├── tool-bridge.ts     # MCP Tool -> AgentTool adapter
│   │   └── resource-bridge.ts # MCP Resource -> read tools
│   ├── config/
│   │   ├── config-store.ts    # Read/write .electric-agents/mcp.json
│   │   └── config-tools.ts    # AgentTools for Horton to manage MCP config
│   └── integration.ts   # createMcpIntegration() factory
```

### Dependencies

- `@modelcontextprotocol/sdk` — official MCP TypeScript SDK (Client, transports, types)
- `@electric-ax/agents-runtime` — peer dependency for `AgentTool` type

## Configuration

### Global config: `.electric-agents/mcp.json`

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    },
    "honeycomb": {
      "url": "https://api.honeycomb.io/mcp",
      "auth": "oauth"
    },
    "internal-api": {
      "url": "https://internal.example.com/mcp",
      "auth": { "token": "sk-..." }
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

- `.electric-agents/mcp.json` — server config (can be committed)
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
  /** Streamable HTTP transport */
  url?: string
  /** Auth: OAuth flow or static token */
  auth?: 'oauth' | { token: string }
  /** Idle timeout before disconnecting (default: 300_000 ms / 5 min) */
  idleTimeoutMs?: number
}

interface McpConfig {
  servers: Record<string, McpServerConfig>
}

type McpOverrides = Record<string, false | McpServerConfig>
```

## McpClient

Thin wrapper around `@modelcontextprotocol/sdk`'s `Client` class. Adds:

- Transport-agnostic construction (pass config, get a connected client)
- Token injection for Streamable HTTP auth
- Typed accessors for `listTools()`, `callTool()`, `listResources()`, `readResource()`

This is not a significant abstraction — it exists to keep transport setup and auth header injection out of the pool.

## MCP Client Pool

Manages lazy connection lifecycle with idle timeout.

```ts
class McpClientPool {
  constructor(config: McpConfig, opts: { workingDirectory: string })
  acquire(serverName: string): Promise<McpClient>
  release(serverName: string): void
  getTools(filter?: { servers?: string[] }): Promise<AgentTool[]>
  getResources(filter?: { servers?: string[] }): Promise<McpResource[]>
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

### Notifications

The pool listens for `tools/list_changed` and `resources/list_changed` notifications from connected servers and re-runs discovery automatically.

## Transports

### Stdio

- Spawns child process with `command` + `args`
- Communicates via stdin/stdout JSON-RPC
- `env` merged with `process.env` + `{ HOME: workingDirectory }`
- Process killed on disconnect, respawned on reconnect

### Streamable HTTP

- HTTP POST to `url` for JSON-RPC requests
- Optional streaming responses via chunked transfer
- Auth headers injected from token store
- Handles 401 responses by triggering OAuth flow

## Auth Flow (OAuth 2.1 + PKCE)

Triggered lazily on first `acquire()` of a server with `auth: 'oauth'`.

1. Client connects to Streamable HTTP endpoint
2. Server responds 401 with OAuth metadata (authorization server URL, scopes)
3. MCP SDK initiates OAuth 2.1 + PKCE — generates code verifier, builds auth URL
4. Runtime starts temporary local HTTP server on random port for OAuth redirect
5. Auth URL printed to logs. If Horton triggered the connection via `mcp_add_server`, the URL is returned as the tool result so the user sees it in chat
6. User authorizes in browser, redirect hits local callback, tokens received
7. Tokens saved to `.electric-agents/mcp-auth.json`
8. Client reconnects with token
9. On subsequent startups, stored tokens are used. Auto-refresh when access token expires

## Tool Bridge

MCP tools are adapted to the `AgentTool` interface (from `@mariozechner/pi-agent-core`).

### Namespacing

Tools are prefixed with server name to avoid collisions: `github__create_issue`, `honeycomb__query`. The prefix is stripped before forwarding calls to the MCP server.

### Adapter

```ts
function bridgeMcpTool(serverName: string, mcpTool: MCP.Tool, pool: McpClientPool): AgentTool {
  return {
    name: `${serverName}__${mcpTool.name}`,
    label: mcpTool.name,
    description: mcpTool.description ?? '',
    parameters: mcpTool.inputSchema,
    execute: async (_toolCallId, params) => {
      const client = await pool.acquire(serverName)
      try {
        const result = await client.callTool(mcpTool.name, params)
        return {
          content: result.content.map(block => {
            if (block.type === 'text') return { type: 'text', text: block.text }
            if (block.type === 'image') return { type: 'image', data: block.data, mimeType: block.mimeType }
            return { type: 'text', text: JSON.stringify(block) }
          }),
          details: { isError: result.isError ?? false },
        }
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

- **`mcp_list_resources`** — lists all resources from connected MCP servers with URIs and descriptions
- **`mcp_read_resource`** — reads a specific resource by server name + URI

This lets the agent decide when to read resources, avoiding context bloat.

## Config Management Tools (for Horton)

Tools added to Horton's tool array so users can configure MCP servers conversationally:

- **`mcp_add_server`** — adds an MCP server to `.electric-agents/mcp.json`. Takes `name`, transport config (`command`/`url`), `auth`. Triggers pool connection + OAuth if needed. Returns success or auth URL.
- **`mcp_remove_server`** — removes a server from config, disconnects from pool.
- **`mcp_list_servers`** — lists configured servers with connection status.
- **`mcp_list_tools`** — lists all tools from connected MCP servers (or filter by server).
- **`mcp_list_resources`** — lists all resources from connected MCP servers.
- **`mcp_read_resource`** — reads a specific resource by server name + URI.

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

Connected MCP servers are summarized dynamically in the agent's system prompt:

```
# MCP Servers
The following external tool servers are connected:
- honeycomb: query observability data (tools: honeycomb__query, honeycomb__list_datasets, ...)
- github: interact with GitHub (tools: github__create_issue, github__search_repos, ...)

Use mcp_list_resources to discover available resources from these servers.
```

Generated from the pool's discovered tools at handler time.

## Error Handling

- **Connection failures** — logged, tools from that server excluded from the entity's tool set. Retried on next `acquire()`.
- **Auth failures** — if stored tokens are expired and refresh fails, tool calls return an error asking the user to re-authenticate via `mcp_add_server`.
- **Tool call failures** — MCP errors passed through as `isError: true` in the tool result. The agent can retry or report to the user.
- **Process crashes (stdio)** — pool detects process exit, marks server as disconnected, reconnects on next `acquire()`.

## Scope Boundaries

### In scope

- Stdio and Streamable HTTP transports
- Tools and Resources
- OAuth 2.1 + PKCE auth flow with token persistence
- Connection pooling with idle timeout
- Config management via Horton tools
- Per-entity-instance overrides
- Tool namespacing
- Dynamic tool/resource list change notifications

### Out of scope (future work)

- SSE transport (deprecated in MCP spec)
- MCP Prompts capability
- MCP Sampling capability (reverse LLM calls)
- Exposing entities as MCP servers
