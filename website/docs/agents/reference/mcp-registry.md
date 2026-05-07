---
title: McpRegistry
titleTemplate: "... - Electric Agents"
description: >-
  API reference for the MCP Registry — addServer, applyConfig,
  subscribe, reauthorize, and the lifecycle of an MCP server entry
  inside the runtime.
outline: [2, 3]
---

# McpRegistry

The MCP registry owns the live set of [Model Context Protocol](https://modelcontextprotocol.io) servers a runtime is connected to. It manages stdio subprocesses and HTTP clients, drives the OAuth state machine, and emits push-based snapshots so embedders can render UI without polling.

**Source:** `@electric-ax/agents-mcp` (re-exported as `McpRegistry` from `@electric-ax/agents`)

`BuiltinAgentsServer.mcpRegistry` exposes the instance that the embedded runtime owns; the [usage guide](/docs/agents/usage/mcp-servers) walks through registering servers from agent-host code.

```ts
interface Registry {
  addServer(cfg: McpServerConfig): Promise<AddServerResult>
  applyConfig(cfg: McpConfig): Promise<AddServerResult[]>
  removeServer(name: string): Promise<void>
  list(): ReadonlyArray<ListedEntry>
  get(name: string): Entry | undefined
  finishAuth(server: string, code: string, state?: string): Promise<AddServerResult>
  reauthorize(name: string): Promise<void>
  disable(name: string): Promise<void>
  enable(name: string): Promise<AddServerResult>
  subscribe(handler: RegistrySubscriber): () => void
}
```

## Methods

| Method                      | Description                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `addServer(cfg)`            | Register or reconfigure a single server. Idempotent on unchanged `(name, url, transport, authMode, scopes, command, args)`. |
| `applyConfig(cfg)`          | Replace the full set of registered servers. Adds new ones, reconfigures changed ones, and removes anything not in `cfg`. |
| `removeServer(name)`        | Tear down a single server: close the transport, drop tokens from the in-memory cache, remove the entry.                  |
| `list()`                    | Returns the current snapshot as a plain array — same shape as the `servers` field of [`RegistrySnapshot`](#registrysnapshot). |
| `get(name)`                 | Internal lookup of a single entry, with the live `transport` handle and the resolved `provider`. Used by IPC handlers.    |
| `finishAuth(name, code, state?)` | Complete the OAuth authorization-code flow for an `authenticating` server. Called by the embedder after intercepting the redirect URI. |
| `reauthorize(name)`         | Force a fresh OAuth flow without removing the entry. Closes the transport, drops cached tokens (hooks remain registered), and rebuilds in place. |
| `disable(name)`             | Pause a server. Closes the transport but keeps the entry; tokens stay in the cache.                                       |
| `enable(name)`              | Re-add a previously-disabled server using its last-known config.                                                          |
| `subscribe(handler)`        | Push-based view of registry state. The handler fires synchronously with a sentinel snapshot, then on every mutation. Returns an unsubscribe function. |

## `addServer` vs `applyConfig`

Both feed the same internal pipeline; pick by what you have:

- **`addServer(cfg)`** — register one server. Use when you're adding an entry in response to a user action, a per-session tool, or a one-off integration.
- **`applyConfig({ servers })`** — replace the full set. Anything in the registry that isn't in `cfg.servers` is removed; existing entries with unchanged config are left alone (no transport churn). This is what the file-based loaders for `mcp.json` and the desktop `settings.json` compile down to.

Idempotency is the load-bearing property: editors save spuriously, file watchers fire double events on macOS, and most apps re-apply the same baseline on every restart. Calling `applyConfig` with the same shape twice does nothing the second time, so it's safe to wire to noisy upstreams.

## `AddServerResult`

`addServer` and `finishAuth` return a discriminated union so the caller can react without inspecting the registry afterwards:

```ts
type AddServerResult =
  | { state: "ready"; id: string; toolCount: number }
  | { state: "authenticating"; id: string; authUrl: string }
  | { state: "error"; id: string; error: McpToolError }
```

| State            | Meaning                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ready`          | Connected and tools listed; calls available at the next agent wake.                                                                |
| `authenticating` | OAuth required. `authUrl` is the URL to send the user to. The desktop's `openAuthorizeUrl` hook opens it in a sandboxed BrowserWindow automatically. |
| `error`          | Connect, transport, or auth-config failure. `error.kind` and `error.message` describe what went wrong.                              |

`applyConfig` returns one `AddServerResult` per server in the supplied config (in the same order).

## Lifecycle of an entry

Every entry transitions through one of five statuses, surfaced on the snapshot. The states that matter to UI:

| Status           | Meaning                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `connecting`     | Transport is being built (DCR, HTTPS discovery) or reconnecting.                                 |
| `authenticating` | OAuth flow needed; `authUrl` is set, browser window is open.                                      |
| `ready`          | Transport connected; tools listed and callable.                                                   |
| `error`          | Transport or auth-config failure. The entry stays in `list()` so the UI can surface the failure. |
| `disabled`       | Operator paused the server via `disable(name)`. Recoverable through `enable(name)`.              |

Transitions are atomic with respect to subscribers: every state change fires a single snapshot in which the entry shows its new status. `reauthorize` mutates entries in place — the row never disappears from `list()`, even mid-rebuild, so renderers don't see a flicker.

## `subscribe(handler)` and `RegistrySnapshot`

```ts
type RegistrySubscriber = (snapshot: RegistrySnapshot) => void

interface RegistrySnapshot {
  seq: number
  servers: ReadonlyArray<ListedEntry>
}
```

Subscribing is the primary way to drive a UI off the registry. The first invocation is synchronous and carries `seq: 0` as a sentinel — embedders treat it as the bootstrap snapshot, not part of the event stream. After that, every mutation increments `seq` (1, 2, 3, …) and broadcasts the full snapshot. A late subscriber still sees `seq: 0` on its first delivery; emitted events continue from the registry's current counter.

Handlers must not throw. The registry catches exceptions per subscriber so a misbehaving consumer can't break the others, but the catch is a safety net, not a feature — log and swallow inside your handler.

```ts
const off = registry.subscribe((snap) => {
  if (snap.seq === 0) {
    // bootstrap — render the initial list
  } else {
    // diff against the previous snapshot, or just re-render
  }
})
// ...
off()
```

## `ListedEntry`

The shape of each `servers[]` entry inside a snapshot:

```ts
interface ListedEntry {
  name: string
  status: McpServerStatus
  toolCount: number
  transport?: "http" | "stdio"
  authMode?: "none" | "apiKey" | "clientCredentials" | "authorizationCode"
  authUrl?: string
  error?: McpToolError
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
  capabilities?: unknown
}
```

| Field          | Type                                              | Description                                                                                  |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `name`         | `string`                                          | The server's stable identifier.                                                              |
| `status`       | `McpServerStatus`                                 | Current lifecycle state — see the table above.                                               |
| `toolCount`    | `number`                                          | Number of tools the server advertises. `0` until `status === "ready"`.                       |
| `transport`    | `"http" \| "stdio"`                               | The transport variant in use.                                                                |
| `authMode`     | `string`                                          | `none` / `apiKey` / `clientCredentials` / `authorizationCode`. UI badges + "show Authorize" check use this. |
| `authUrl`      | `string`                                          | Set while `status === "authenticating"`. The URL to open for OAuth consent.                  |
| `error`        | [`McpToolError`](#mcptoolerror)                   | Set while `status === "error"`.                                                              |
| `tools`        | `Array<{ name; description?; inputSchema }>`      | Tool metadata as advertised by the server. Each becomes `mcp__<server>__<tool>` for the LLM. |
| `capabilities` | `unknown`                                         | Server-declared MCP capabilities object (resources, prompts, etc.).                          |

## `McpToolError`

```ts
interface McpToolError {
  kind: McpToolErrorKind
  message: string
  details?: unknown
}

type McpToolErrorKind =
  | "auth_unavailable"
  | "transport_error"
  | "timeout"
  | "server_error"
  | "tool_not_found"
```

The same shape surfaces on entry-level `error` (when `addServer` fails to connect) and on individual tool calls. See the [usage guide's failure modes table](/docs/agents/usage/mcp-servers#failure-modes).

## `RegistryOpts`

`BuiltinAgentsServer` constructs the registry on your behalf. You only see this shape if you instantiate `agents-mcp` directly (e.g. from a custom embedder):

```ts
interface RegistryOpts {
  publicUrl?: string
  openAuthorizeUrl?: (url: string, server: string) => void
}

function createRegistry(opts: RegistryOpts): Registry
```

| Field              | Description                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `publicUrl`        | Base URL used to construct the OAuth `redirect_uri` sentinel. The desktop sets this to the runtime's local URL; it never receives an actual HTTP request — see the OAuth callback section of the usage guide. |
| `openAuthorizeUrl` | Hook invoked when an `authorizationCode` server first needs consent. Receives the SDK-generated authorize URL. The desktop opens it in a sandboxed `BrowserWindow`; headless embedders can read the URL from the `authenticating` envelope of `addServer` and surface it themselves. |

## See also

- [MCP servers usage guide](/docs/agents/usage/mcp-servers) — the practical walkthrough of registering servers, OAuth, persistence, and the per-agent allowlist.
- [`McpServerConfig`](/docs/agents/reference/mcp-server-config) — schema for the `cfg` argument to `addServer` / `applyConfig`.
- [`BuiltinAgentsServer`](/docs/agents/usage/embedded-builtins) — host options that affect MCP, including `extraMcpServers` and `openAuthorizeUrl`.
