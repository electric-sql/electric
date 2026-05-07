---
title: MCP servers
titleTemplate: "... - Electric Agents"
description: >-
  Connect agents to external tools, resources, and prompts via the
  Model Context Protocol. Register servers programmatically through the
  Registry API, declaratively in mcp.json, or globally in the desktop
  app's settings.
outline: [2, 3]
---

# MCP servers

The runtime ships an embedded **MCP registry** that connects agents to external [Model Context Protocol](https://modelcontextprotocol.io) servers — both locally-spawned `stdio` servers and remote `Streamable HTTP` servers. Tools, resources, and prompts exposed by those servers become available to every entity at the next wake without per-agent wiring.

## Registering servers

`Registry` is the primary API. Agent authors call into it directly when they're defining or hosting agents in code. `mcp.json` and the desktop app's `settings.json` are file-based convenience layers that the runtime turns into the same `Registry.applyConfig()` calls under the hood.

### Programmatic — `Registry.addServer()` / `applyConfig()`

`BuiltinAgentsServer` exposes the registry through `mcpRegistry`. Add servers from code anywhere it's the right shape — at boot from your own config source, in response to user actions, or per-session for tools an agent should only see during a specific task:

```ts
import { BuiltinAgentsServer } from "@electric-ax/agents"

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  port: 4448,
  workingDirectory: process.cwd(),
})

await server.start()

const result = await server.mcpRegistry?.addServer({
  name: "stripe",
  transport: "http",
  url: "https://mcp.stripe.com/mcp",
  auth: {
    mode: "apiKey",
    headerName: "Authorization",
    key: process.env.STRIPE_MCP_KEY!,
  },
})
```

`addServer` returns a discriminated [`AddServerResult`](#addserverresult) — `{ state: "ready" | "authenticating" | "error", … }`. The state landscape is described in [Server states](#server-states) below; the full lifecycle (hot-reload, reauthorize, timeouts) lives in [Lifecycle](#lifecycle).

The bulk methods are:

- `applyConfig(cfg)` — replace the full set of servers. Idempotent on unchanged entries; removes anything not in the supplied config. This is what file-based config layers compile down to.
- `subscribe(handler)` — push-based view of the live state, including `ready` / `authenticating` / `error` transitions. Useful when an embedder renders its own UI on top of the registry.
- `reauthorize(name)`, `disable(name)`, `enable(name)`, `removeServer(name)` — single-server lifecycle.

Static secrets (`apiKey.key`, `clientCredentials.clientId` / `clientSecret`) are passed inline at the call site — typically read from `process.env`. The runtime never reads environment variables on the embedder's behalf. See [`McpServerConfig`](/docs/agents/reference/mcp-server-config) for the full schema.

### File-based — `mcp.json`

For static, project-scoped configuration the runtime auto-loads `mcp.json` from the configured `workingDirectory` (or the process cwd for headless embedders) on boot, watches it for changes, and hot-reloads adds, removes, and reconfigurations through `applyConfig` — exactly as if you'd called the API yourself. In-flight tool calls finish on the old config; new calls pick up the new one.

`mcp.json` carries structural shape only — no secrets:

```jsonc
{
  "servers": {
    "honeycomb": {
      "transport": "http",
      "url": "https://mcp.honeycomb.io/mcp",
      "auth": {
        "mode": "authorizationCode",
        "scopes": ["mcp:read", "mcp:write"]
      }
    },
    "internal-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "auth": {
        "mode": "apiKey",
        "headerName": "X-Api-Key"
      }
    },
    "git-local": {
      "transport": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-git",
        "--repository",
        "${workspaceRoot}"
      ]
    }
  }
}
```

For [`authorizationCode`](#authorization-code-oauth) servers in `mcp.json`, the runtime auto-wires `keychainPersistence` so OAuth tokens survive process restarts via the OS keychain.

### Desktop settings layer

The Electron desktop app exposes a second file-based layer: a global `mcp.servers` array in its `settings.json`, applied to every workspace. It composes with the workspace `mcp.json` instead of replacing it:

- Servers from both files load together when their names don't collide.
- On a name collision, the workspace `mcp.json` wins (project scope overrides global).
- `keychainPersistence` is auto-wired for OAuth servers from either source.

The `settings.json` lives at:

| OS      | Path                                                    |
| ------- | ------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Electric Agents/`        |
| Linux   | `~/.config/Electric Agents/`                            |
| Windows | `%APPDATA%\Electric Agents\`                            |

Example shape:

```jsonc
{
  "servers": [...],
  "activeServer": {...},
  "workingDirectory": "/Users/me/workspace/foo",
  "apiKeys": {...},
  "mcp": {
    "servers": [
      {
        "name": "linear",
        "transport": "http",
        "url": "https://mcp.linear.app/sse",
        "auth": { "mode": "authorizationCode", "scopes": ["mcp:read"] }
      }
    ]
  }
}
```

Embedders other than the desktop app pass the same array via `BuiltinAgentsServer({ extraMcpServers })`.

## Per-agent allowlist

Entity definitions opt into MCP servers explicitly via the `mcp.tools()` helper from `@electric-ax/agents-runtime`:

```ts
import { mcp } from "@electric-ax/agents-runtime"

registry.define("research-agent", {
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: "...",
      tools: [
        ...ctx.electricTools,
        ...mcp.tools(["sentry", "github"]), // explicit list
        // or: ...mcp.tools("*")              // every registered server
      ],
    })
    await ctx.agent.run()
  },
})
```

The resolved tool set is recorded in the agent's manifest at compose time. Tools are exposed to the model with always-prefixed names matching Anthropic's tool-name regex (`^[a-zA-Z0-9_-]{1,128}$`):

- Tools: `mcp__sentry__search`, `mcp__github__create_issue`, …
- Resources: `mcp__<server>__list_resources`, `mcp__<server>__read_resource`
- Prompts: `mcp__<server>__list_prompts`, `mcp__<server>__get_prompt`

Built-in entities `horton` and `worker` opt in to all registered servers via `mcp.tools("*")`.

## Auth modes

Each server declares one auth mode. The runtime keeps a valid token in hand on every call: silent refresh when possible, or a structured `auth_unavailable` error to the agent's model when not.

### `apiKey`

```ts
auth: {
  mode: "apiKey",
  key: process.env.X_API_KEY!,
  headerName: "X-Api-Key",  // default "Authorization"
  valuePrefix: "Bearer ",   // optional
}
```

The header is sent on every request. Rotate by editing the config; the registry's idempotency check picks up the change and rebuilds the transport on the next reload.

### `clientCredentials`

```ts
auth: {
  mode: "clientCredentials",
  tokenUrl: "https://auth.example.com/oauth/token",
  clientId: process.env.X_CLIENT_ID!,
  clientSecret: process.env.X_CLIENT_SECRET!,
  scopes: ["mcp:read"],
}
```

The runtime exchanges the client credentials for short-lived access tokens silently. No user interaction.

### `authorizationCode` (OAuth)

```ts
auth: {
  mode: "authorizationCode",
  scopes: ["mcp:read"],
  // optional — pre-registered OAuth client (skips DCR)
  client: { clientId: "...", clientSecret: "..." },
  // optional — pre-existing tokens (skips OAuth flow on boot)
  tokens: { accessToken: "...", refreshToken: "...", expiresAt: 1736e9 },
  // fires on initial auth + every refresh — wire to your persistence
  onTokensChanged: async (t) => { /* persist */ },
  // fires once after RFC 7591 DCR completes
  onClientRegistered: async (c) => { /* persist */ },
}
```

The MCP SDK handles PKCE, RFC 7591 Dynamic Client Registration, RFC 9728 Protected Resource Metadata discovery, and 401-retry transparently. The first time a server is used:

1. The runtime captures an authorize URL and surfaces it through the `openAuthorizeUrl(url, server)` hook on `BuiltinAgentsServer`.
2. The Electron desktop opens the URL in a sandboxed `BrowserWindow` and intercepts the `redirect_uri` navigation client-side — the redirect URL is never actually fetched, so no HTTP listener is needed.
3. The runtime exchanges the captured `code` + `state` for tokens and fires `onTokensChanged`.

Subsequent restarts re-seed from persisted tokens; refresh-token rotation happens silently on every call.

#### Persistence helpers

`@electric-ax/agents-mcp` ships two opt-in helpers that produce the auth-config slice:

```ts
import { keychainPersistence, filePersistence } from "@electric-ax/agents-mcp"

const honeycomb = await keychainPersistence({ server: "honeycomb" })

await mcpRegistry.addServer({
  name: "honeycomb",
  transport: "http",
  url: "https://mcp.honeycomb.io/mcp",
  auth: {
    mode: "authorizationCode",
    scopes: ["mcp:read"],
    ...honeycomb,
  },
})
```

| Helper                             | Backing store                                                    | When to use                                              |
| ---------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| `keychainPersistence({ server })`  | OS keychain (macOS `security`, Linux `secret-tool`)              | Local dev / desktop apps; tokens encrypted by the OS     |
| `filePersistence({ path, server })` | Mode-`0600` JSON file                                           | CI / containers without an OS keychain                   |

For Vault, SSM, or a custom secret system, write your own `onTokensChanged` and `onClientRegistered` directly. The contract is two callbacks and two optional values.

## Server states

Every server entry the registry tracks is in exactly one of five states. The state is the `status` field on `ListedEntry` (returned by `Registry.list()` and emitted on every snapshot through `subscribe`), and it's the discriminator on the `AddServerResult` envelope returned from `addServer` / `applyConfig` / `finishAuth` / `enable`.

| State            | Meaning                                                                                                                            | Side data                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `connecting`     | Transport is being built (RFC 9728 discovery, RFC 7591 DCR, stdio spawn, HTTP handshake) or rebuilt after `reauthorize` / `enable`. | —                                               |
| `authenticating` | An `authorizationCode` server needs the user. The SDK has produced an authorize URL; the embedder's `openAuthorizeUrl` hook fired. | `authUrl: string`                               |
| `ready`          | Connected. Tools listed. Calls succeed and stream through the bridge.                                                              | `toolCount: number`, `tools: [...]`             |
| `error`          | Transport, auth-config, or `addServer` validation failure. The entry stays in `list()` so the UI can surface the failure.          | `error: { kind, message, details? }`            |
| `disabled`       | Operator paused the server via `Registry.disable(name)`. Transport closed; tokens stay in the cache.                                | —                                               |

Transitions are driven by registry methods. The high-level shape:

```
                    ┌──────────────┐    success     ┌──────────┐
   addServer ──────▶│  connecting  │───────────────▶│  ready   │
   applyConfig      └──────┬───────┘                └────┬─────┘
   enable                  │                             │
                           │ no tokens / 401             │
                           ▼                             │
                    ┌──────────────┐  finishAuth         │
                    │authenticating│───────────────────▶─┘
                    └──────┬───────┘  (retries connect)
                           │
                           │ unrecoverable
                           ▼
                    ┌──────────────┐
                    │    error     │
                    └──────────────┘

   reauthorize:  any non-disabled  ──▶ connecting ──▶ authenticating
   disable:      any               ──▶ disabled
   enable:       disabled          ──▶ connecting ──▶ ready (or authenticating, or error)
   removeServer: any               ──▶ (entry gone)
```

A few specifics worth knowing:

- **`error` is sticky.** It doesn't auto-recover. Reach `ready` again by calling `addServer` with the same config (idempotency picks up changes), `reauthorize(name)`, or — for transient transport issues — re-running through `applyConfig`. The entry stays in the snapshot the whole time.
- **`reauthorize` always lands in `connecting` first**, then typically `authenticating` because tokens are intentionally cleared. The mutation is in-place — subscribers never see the entry disappear, so renderers don't flicker.
- **`disable` is recoverable.** It closes the transport but keeps tokens, hooks, and the entry. `enable` rebuilds the transport from the same config; if tokens are still valid, the next state is `ready` without an OAuth round-trip.
- **`removeServer` is destructive.** It clears tokens from the in-memory cache (persisted tokens via `onTokensChanged` stay where the operator put them) and removes the entry. There is no UI affordance for it on the desktop — Disable is the recoverable equivalent.

For the full per-method API (including `subscribe`, `RegistrySnapshot`, and `RegistryOpts`), see the [`McpRegistry` reference](/docs/agents/reference/mcp-registry).

## Lifecycle

### Hot-reload

Editing `mcp.json` (or calling `applyConfig` programmatically) takes effect immediately:

- **New server.** Tools available at the next tool-selection step in any active wake; manifests of agents using `mcp.tools("*")` update at the next compose.
- **Removed server.** In-flight tool calls complete or fail cleanly; no new calls dispatch; stdio subprocesses terminate after in-flight calls drain.
- **Reconfigured server.** Takes effect on the next tool call to that server. In-flight calls finish on the old config.

`addServer` and `applyConfig` are idempotent on unchanged config — they compare by `(name, url, transport, authMode, scopes, command, args)` and short-circuit when nothing changed. Spurious file-system events from macOS reload watchers won't tear down healthy connections.

### Re-authorize

Calling `Registry.reauthorize(name)` forces a fresh OAuth flow without removing the entry from the registry. The transport is closed, tokens are dropped from the in-memory cache (hooks remain registered), and the SDK produces a new authorize URL that fires through the `openAuthorizeUrl` hook. The entry stays in every snapshot throughout, so subscribers don't see it disappear and reappear.

The desktop's **Authorize** button (visible whenever a server is in `authenticating`) routes through this method. There's no manual "force a fresh token" affordance for healthy servers — the registry reauthorizes automatically when the SDK can't refresh the existing one.

### Per-call timeouts

Every MCP tool call has a timeout (default 30 seconds, overridable per server via `timeoutMs`). When exceeded, the bridge cancels the call (JSON-RPC cancellation for stdio servers; HTTP request abort for HTTP servers) and resolves it with a `timeout` error result. The agent's model decides what to do — retry, fall back, abort.

The timeout is a hygiene feature, not a long-running-call solution. Tool calls in v1 are synchronous within the wake.

## Connected Services UI (desktop)

The Electron desktop ships a **Settings → MCP Servers** page that mirrors `Registry.subscribe` over Electron IPC. Each row shows:

- **Name and transport** (stdio / http).
- **Auth mode** (apiKey / clientCredentials / authorizationCode).
- **Status** — `connecting`, `authenticating`, `ready`, `error`, or `disabled`.
- **Tool count + expandable tool list.**
- **Per-row actions:** Authorize (only when a server is in `authenticating`), Reconnect, Disable / Enable.

The page is the operator's primary mechanism for noticing and fixing broken credentials, and the developer's primary surface for kicking off initial OAuth flows. There is no Disconnect action: removal of an entry happens via editing the config file. Disable pauses without losing state and is recoverable from the UI.

## Failure modes

The runtime returns a structured error to the agent's model on any tool-call failure it can't transparently recover from:

| Kind                | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `auth_unavailable`  | Silent refresh failed and no credential is usable; operator must reauthorize.          |
| `transport_error`   | Server unreachable, connection dropped, malformed response.                            |
| `timeout`           | Call exceeded its per-call timeout.                                                    |
| `server_error`      | The MCP server returned a structured error.                                            |
| `tool_not_found`    | Capability mismatch (e.g. server's tool list changed since compose).                   |

Agents handle these like any other tool error: retry, fall back, give up gracefully, or escalate to the user. The runtime doesn't block tool calls indefinitely waiting for out-of-band recovery.

## Reference

- [`McpRegistry`](/docs/agents/reference/mcp-registry) — full API: `addServer`, `applyConfig`, `subscribe`, `reauthorize`, the lifecycle, snapshot envelope, and `RegistryOpts` for custom embedders.
- [`McpServerConfig`](/docs/agents/reference/mcp-server-config) — schema for the `cfg` argument to `addServer` / `applyConfig`.
- [`BuiltinAgentsServer` options](/docs/agents/usage/embedded-builtins) — the `extraMcpServers` and `openAuthorizeUrl` options used to wire embedder-specific MCP behavior.
