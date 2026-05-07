# MCP Support for Electric Agents — Design Spec

**Status:** Draft — **Experimental feature**
**Date:** 2026-05-05
**Author:** Valter Balegas (with Claude)

> **Experimental.** This is the first cut of MCP integration. We expect to evolve the registration model (e.g. stream-based registration via the existing `entity_types` shape pattern, server-side delegated discovery, multi-tenant credential scopes) once the direct-call design has been used in anger. Public surfaces marked here may change without a deprecation cycle while the feature carries the experimental flag.

## Summary

Add Model Context Protocol (MCP) support to Electric Agents so agents can call tools and read data from external MCP servers — both locally-spawned stdio servers and remote HTTP servers — with credentials managed by the runtime.

## Goals

- Agents can call MCP tools from servers declared in runtime config.
- Both stdio (local subprocess) and Streamable HTTP transports.
- All three credential modes: API key, OAuth client credentials, OAuth authorization code (browser-redirect and device-code variants).
- Silent token refresh on every call where possible. When silent refresh isn't possible, the tool call returns a structured error to the agent's model.
- Per-call timeouts so a misbehaving or slow server can't hang a wake.
- A web UI surface (agents-server-ui) showing server health and providing reauth actions.
- Servers added/removed/reconfigured at runtime are visible to running agents within the same wake.
- Pluggable key vault interface; default file-on-disk implementation for v1.

## Non-goals (v1)

- **Wake-level suspend for long-running tool calls.** Tool calls are synchronous within the wake; if a call exceeds the per-call timeout it fails with `timeout`. The MCP servers in the v1 use cases (Sentry, Honeycomb, GitHub, Linear, Notion, internal docs, codebase stdio servers) all return in seconds. Genuinely long-running MCP servers (CI orchestrators, deep-research, LLM-wrapping servers) are rare/emerging; we'll add wake suspension when a concrete use case shows up. The durable runtime makes it cheap to add later.
- **User identity / per-user credentials.** Electric Agents has no user record today. Credentials are app-scoped: one set per registered server.
- **Spawn-scoped credentials.** Future addition once identity exists.
- **Durable pause-and-resume of tool calls on auth failure.** Auth failures resolve as tool errors the agent's model handles; the operator fixes broken credentials via the catalog page; future invocations work. We considered a runtime-managed pause-on-reauth primitive (block the call until the user reauthorizes, then resume) but it complicates the model and risks blocked agents waiting on humans who don't return. Revisit only if a use case demands it.
- **Active background token refresher.** Refresh-on-use plus the catalog page handle correctness.
- **Legacy SSE transport** (deprecated in the MCP spec). **WebSocket** (not in spec).
- **In-process resource limits** for stdio subprocesses. Operators apply limits externally (containerization).

## User stories

The user stories below describe the **software-factory patterns** Electric Agents enables once MCP support is in place. MCP is the substrate that makes the integration surface uniform — every SaaS tool, observability platform, codebase, and internal data source becomes a pluggable tool surface for any agent in the factory.

### US-1: Incident response factory

A signal (Sentry alert, Honeycomb trigger, PagerDuty page) fires a webhook. An investigator agent wakes, pulls context across multiple observability MCP servers (Sentry, Honeycomb, Datadog), correlates it with recent code changes via a GitHub MCP server, and reads runbooks from an internal-docs MCP server. It produces a structured incident summary in the on-call channel. If the signal warrants remediation, it spawns a coding subagent that opens a PR through the GitHub MCP. Operators can audit, after the fact, which servers each agent touched and why.

_MCP unlocks this by giving every observability platform and code host a uniform tool surface — adding Datadog to the factory is registering a new server, not writing a new integration. Runtime-owned credentials let the same workflow run unattended at 3am as well as during business hours._

### US-2: Coding-agent factory

A developer kicks off a coding task in a horton chat. The agent plans the work using Linear and GitHub MCP servers, drafts code locally with stdio MCP servers (filesystem, git, language servers, type-checkers), and pushes a branch via the GitHub MCP using the developer's credentials. It spawns specialized subagents for narrow subtasks — a test-writer, a docs-updater, a deploy-checker — each inheriting the same MCP allowlist.

_MCP support makes coding agents portable across companies: every customer plugs in their own MCP servers without the runtime needing per-company integrations. The split between app-scoped servers (the company's shared SaaS) and the developer's local stdio servers (their working environment) maps cleanly to "what the factory reads" vs "what the developer acts through."_

### US-3: Continuous knowledge factory

Scheduled agents periodically query company-internal sources (Notion, Slack, Drive, Linear, internal wikis) and external ones (web search, GitHub, arxiv) to produce role-specific digests — a security report for the CISO, a product-feedback rollup for PMs, a research feed for engineers. New sources are added by registering an MCP server; running agents pick them up at the next wake.

_MCP's hot-reload support means the factory's "what we research" surface evolves by config edit, not by deploy. Each digest pipeline is a small composition of MCP servers and a prompt — easy to spin up new ones without touching runtime code._

## Architecture

### Components

```
┌──────────────────────────────────────────────────────────────────┐
│             agents-server (no MCP state, no proxy)               │
│                                                                  │
│  • Hosts the UI (static + dev server)                            │
│  • Postgres + Electric + durable streams + entity bridge         │
│  • /api/runtimes — discovery endpoint listing registered         │
│    runtime processes and the public URLs the UI should call      │
│    directly for MCP reads/writes                                 │
│  • Holds NO vault, NO coordinator, NO MCP state                  │
└──────────────────────────────────────────────────────────────────┘
        ▲                                          ▲
        │ entity-type registration                 │ /api/runtimes
        │ (now includes the runtime's              │ (UI reads list
        │  publicly-reachable URL)                 │  of runtime URLs)
        │                                          │
        │                                          │
┌───────┴──────────────────────────────────────────┴───────────────┐
│   runtime-hosting process (e.g. builtin-agents)                  │
│   — sole owner of all MCP state, publicly addressable            │
│                                                                  │
│  ┌─────────────────────┐  ┌────────────────────────────────┐    │
│  │  MCP Registry       │  │  CredentialStore (bootstrap)   │    │
│  │  - mcp.json (no     │  │  - getApiKey / get/save tokens │    │
│  │    secrets) +       │  │  - get/save OAuth client info  │    │
│  │    addServer() API  │  │  - Default dev: composed(      │    │
│  │  - Idempotent on    │  │      env, osKeychain, file)    │    │
│  │    (name,url,auth)  │  │  - Production: operator wires  │    │
│  │  - Manages stdio    │  │    against own vault           │    │
│  │    subprocesses     │  └────────────────────────────────┘    │
│  └──────────┬──────────┘  ┌────────────────────────────────┐    │
│             │             │  SDK OAuthClientProvider       │    │
│             │             │  - PKCE / DCR / discovery      │    │
│             │             │  - Refresh / 401-retry         │    │
│             │             │  - Backed by CredentialStore   │    │
│             │             │  - Per-server escape-hatch     │    │
│             │             └────────────────────────────────┘    │
│             │                                                    │
│  ┌──────────▼──────────────────────────────────────────────┐    │
│  │  MCP Bridge (per-tool-call)                             │    │
│  │  - SDK transport with OAuthClientProvider               │    │
│  │  - Routes call (stdio JSON-RPC / Streamable HTTP)       │    │
│  │  - Enforces per-call timeout                            │    │
│  │  - On unrecoverable failure: returns structured error   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  agents-runtime tool-provider hook auto-injects mcpHandle.tools()│
│  into every entity-type's tool list at wake time — no per-agent  │
│  wiring.                                                         │
│                                                                  │
│  Public HTTP surface (called directly by the UI):                │
│  • GET  /api/mcp/servers     — list with live tool counts        │
│  • POST /api/mcp/servers/:s/authorize  — start OAuth, returns    │
│      { state: 'ready' | 'authenticating', authUrl? }             │
│  • POST /api/mcp/servers/:s/disable | enable | disconnect        │
│  • GET  /oauth/callback/:s   — OAuth provider redirects HERE,    │
│      not to agents-server                                        │
└──────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    agents-server-ui                              │
│  • At startup: GET ${agentsServerUrl}/api/runtimes               │
│  • For Connected Services page: GET ${runtime.publicUrl}/api/mcp │
│  • Authorize button: POST runtime → opens authUrl in new tab     │
└──────────────────────────────────────────────────────────────────┘
```

### Runtime discovery (UI → runtime, direct)

The runtime is the single source of truth for MCP state. The UI talks to it directly. agents-server's only role is to tell the UI **where** the runtime is.

**Step 1 — runtime announces itself.** The existing entity-type registration handshake is extended with a `publicUrl`:

```ts
// runtime → agents-server at startup
POST /_electric/agents/types
{
  "types": ["horton", "worker"],
  "publicUrl": "http://runtime.example.com:4448"
}
```

agents-server holds `(name, publicUrl, types[])` per runtime in memory. State is rebuilt at boot when each runtime re-registers, so a server restart costs nothing.

**Step 2 — UI discovers runtimes.** A single endpoint:

```
GET /api/runtimes
→ [{ "name": "builtin-agents", "publicUrl": "http://runtime.example.com:4448", "types": ["horton", "worker"] }]
```

UI fetches once on mount, refetches on focus or every ~60s.

**Step 3 — UI talks to the runtime directly.** Every MCP read and mutation is a direct cross-origin request to `${runtime.publicUrl}/api/mcp/...`. agents-server is not in the data path. CORS on the runtime allows the agents-server origin (configurable; `*` in dev).

#### Runtime HTTP surface (mounted by `mountMcpHttp`)

```
GET    /api/mcp/servers
  → [{ name, transport, url|command, authMode, status, authUrl?, error?, toolCount, tools? }]
  status ∈ 'connecting' | 'authenticating' | 'ready' | 'error' | 'disabled'

POST   /api/mcp/servers                       (programmatic add — same envelope as addServer)
POST   /api/mcp/servers/:name/authorize       → { authUrl }
POST   /api/mcp/servers/:name/disable
POST   /api/mcp/servers/:name/enable
POST   /api/mcp/servers/:name/reconnect
DELETE /api/mcp/servers/:name

GET    /oauth/callback/:server                 (OAuth provider redirects HERE)
POST   /oauth/device/:server/start             (device flow)
```

Mutations return the same `AddServerResult` envelope (`ready` | `authenticating` | `error`) so a single response shape covers list/add/authorize/reconnect.

#### Live updates: poll first, SSE later

There is no shape, no DB row for MCP state — it lives in the runtime's memory. The UI keeps in sync via:

- **Phase 1 — polling.** UI polls `GET /api/mcp/servers` every 10s when idle, ramped to ~2s during an active OAuth flow (any row in `authenticating`). Cheap, simple, ships with the rest of the feature.
- **Phase 2 — SSE on the runtime.** `GET /api/mcp/events` (`text/event-stream`) emits `server.added` / `server.status` / `server.tools.changed` / `server.removed` events. UI keeps one EventSource per runtime, falls back to polling on disconnect. Added when polling becomes the bottleneck — not before.

#### Why this closes the "tool count always 0" gap

The UI reads from the same registry that owns the live tools. There is no second copy to keep in sync, no proxy state to invalidate. Disable/enable hit the actual registry, so they stop being cosmetic.

#### Auth on the runtime API

Dev: no auth — the runtime listens on localhost. Production: the runtime accepts a shared bearer (`RUNTIME_API_TOKEN`) which the agents-server hands to the UI via a session-scoped token endpoint. The hook is reserved in the API; the implementation is out of scope for the first cut.

### Package boundaries

| Concern                                                                                        | Package                                            | Notes                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Registry, transports, bridges, MCP HTTP routes, `CredentialStore`, OAuthClientProvider adapter | `agents-mcp`                                       | Self-contained, Node-specific, exports `mountMcpHttp(deps)` for any embedder. Owns no agents-server-specific code. |
| Tool-provider injection at wake time                                                           | `agents-runtime`                                   | Tiny hook: `registerToolProvider({ name, tools })` — providers run at compose time. No per-agent wiring.           |
| Runtime registration with public URL + UI hosting + `/api/runtimes` discovery                  | `agents-server`                                    | No MCP state. No proxy. Discovery only.                                                                            |
| Bootstrap wiring (one-time)                                                                    | `packages/agents` (and any other runtime embedder) | Constructs registry + CredentialStore, calls `mountMcpHttp` and `registerToolProvider` once.                       |

### Transports and where they run

| Transport           | Where runs                                                   | Notes                                                                                                      |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **stdio**           | Subprocess of the agents-server runtime, on the runtime host | Lazy-spawned on first tool call; one process per server; multiplexed via JSON-RPC `id`; restarted on crash |
| **Streamable HTTP** | Anywhere network-reachable                                   | Single HTTP endpoint per spec; server-pushed messages over SSE inside the response stream                  |

In local-dev, the runtime is the developer's machine, so stdio servers can read local user credentials (e.g. an existing `gh` CLI token via env). In a server-hosted deployment, the runtime is on the agents-server host; stdio servers there are inherently shared/system-level. **Stdio + personal credentials is a local-dev pattern, not a deployment pattern** — documented prominently.

### Credential model

Three auth modes per server:

| Mode                                        | Initial setup                                 | Steady state                                             | Operator action when fails |
| ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| `apiKey`                                    | Operator pastes key into vault                | Never expires until rotated                              | Rotate key                 |
| `clientCredentials`                         | Operator pastes `client_id` + `client_secret` | Runtime exchanges for short-lived access tokens silently | Rotate client secret       |
| `authorizationCode` (`browser` or `device`) | Browser/device flow → user approves           | Silent refresh on each use; refresh tokens rotate        | Re-consent via catalog     |

The mode is declared per server in `mcp.json`. Picking `authorizationCode` for a server an unattended workflow needs is a configuration smell — the schema validator should warn (and the docs should call it out).

### Token handling

The runtime always tries to keep a valid token in hand:

- **Valid token in vault** → call proceeds.
- **Expired access token + valid refresh token (or clientCredentials)** → silent refresh under a per-`(server, scope)` mutex; on success the call retries transparently. The agent never sees this happen.
- **Silent refresh impossible** (no credential, refresh token expired/revoked, OAuth provider unreachable) → the tool call resolves with a structured `auth_unavailable` error. The agent's model decides what to do (retry, fall back, abort, surface to the user). The credential issue is also reflected on the Connected Services catalog so an operator can fix it; once fixed, future calls work normally.

The mutex on the refresh exchange is what prevents the [Claude Code #24317](https://github.com/anthropics/claude-code/issues/24317) class of bug where concurrent sessions invalidate each other's single-use refresh tokens.

### Per-call timeouts

Every MCP tool call has a timeout (default 30s, overridable per server in `mcp.json`). When exceeded, the bridge cancels the call (JSON-RPC cancellation for stdio servers; HTTP request abort for HTTP servers) and resolves it with a `timeout` error result. The agent's model decides what to do.

The timeout is a hygiene feature, not a long-running-call solution. Calls in v1 are synchronous within the wake; the timeout exists to prevent a misbehaving server from hanging the wake indefinitely.

## SDK shape

### Two creation modes

Operators can register MCP servers either declaratively (in `mcp.json`) or programmatically. Both produce the same `Registry` entries and consume the same `CredentialStore` for keys/tokens.

**Declarative — `mcp.json`** (the 80% case)

`mcp.json` declares servers' structural shape — name, transport, URL, auth mode, scopes — and contains **no secrets**. Watched for changes; edits hot-reload.

```jsonc
{
  "servers": {
    "honeycomb": {
      "transport": "http",
      "url": "https://mcp.honeycomb.io/mcp",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
        "scopes": ["mcp:read", "mcp:write"],
      },
    },
    "linear": {
      "transport": "http",
      "url": "https://mcp.linear.app/sse",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
      },
    },
    "internal-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "auth": {
        "mode": "apiKey",
        "headerName": "X-Api-Key",
      },
    },
    "machine-svc": {
      "transport": "http",
      "url": "https://svc.example.com/mcp",
      "auth": {
        "mode": "clientCredentials",
        "tokenUrl": "https://svc.example.com/oauth/token",
        "scopes": ["read", "write"],
      },
    },
    "git-local": {
      "transport": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-git",
        "--repository",
        "${workspaceRoot}",
      ],
    },
  },
}
```

Note what's gone: no `clientIdRef`, `clientSecretRef`, `valueRef` — `mcp.json` has zero references to where secrets live. The runtime asks the `CredentialStore` (configured at bootstrap) for any keys it needs at the moment it needs them.

**Programmatic — runtime API** (advanced cases)

```ts
import { runtime } from '@electric-ax/agents-runtime'

const result = await runtime.mcp.addServer({
  name: 'temp-stripe',
  transport: 'http',
  url: 'https://mcp.stripe.com/mcp',
  auth: { mode: 'apiKey', headerName: 'Authorization' },
  // Optional: pass credentials inline. The runtime stores them in the
  // CredentialStore under the new server's name. If absent, the store
  // is consulted in the usual way.
  credentials: { apiKey: 'rk_live_…' },
})

if (result.state === `authenticating`) {
  // Hand result.authUrl back to the user / browser.
} else if (result.state === `ready`) {
  // Server is connected and tools are listed.
} else {
  // result.state === `error` — result.error has the details.
}
```

#### Connection-state return type

`addServer` returns a discriminated union so callers don't have to introspect status to decide whether a redirect is needed:

```ts
type AddServerResult =
  | { state: 'ready'; id: string; toolCount: number }
  | { state: 'authenticating'; id: string; authUrl: string }
  | { state: 'error'; id: string; error: McpServerError }
```

Borrowed from Cloudflare Agents' `addMcpServer` shape; the caller's flow is `if (state === 'authenticating') redirect(authUrl)` rather than "register, then poll status."

#### Idempotency on unchanged config

`addServer` and `applyConfig` both compare the incoming config against the existing entry by `(name, url, transport, authMode, scopes, command, args)`. When unchanged, the registry is a no-op — existing transports and tool caches are preserved. This matters because `mcp.json` reload fires on every file change (often spuriously on macOS), and programmatic callers may register on every wake. Without idempotency, every reload tears down healthy connections.

When config has drifted, the registry closes the old transport, builds a new one, and resolves status fresh.

#### Escape-hatch `oauthProvider`

For mTLS, pre-registered DCR clients, OIDC quirks, or any auth-server idiosyncrasy not covered by the `CredentialStore` shape, callers can supply a fully-formed MCP-SDK `OAuthClientProvider` per server. This bypasses the `CredentialStore` for that one server entirely:

```ts
runtime.mcp.addServer({
  name: 'internal-mtls',
  transport: 'http',
  url: 'https://internal.example.com/mcp',
  auth: {
    mode: 'authorizationCode',
    oauthProvider: myCustomOAuthClientProvider,
  },
})
```

The same field is allowed in `mcp.json` per server, but only by reference (e.g. `"oauthProviderRef": "myProviderName"` resolved against a map of providers passed at bootstrap), since `mcp.json` can't carry runtime objects.

Programmatic registration is useful for agents that spin up servers in response to user actions (e.g. a coding-agent starting a project-scoped MCP server for the duration of a task). The same `CredentialStore` mediates access for both creation modes.

### Credential handling

The runtime owns no secret persistence and exposes no credential-store contract on its public surface. Two principles:

1. **Static secrets (API keys, M2M client_id/secret, pre-registered OAuth client, pre-existing tokens) are passed inline in the `auth` config.** The developer's call site is the only place that knows where their secret came from (env var, vault, ...); `agents-mcp` never reads `process.env` on their behalf.
2. **Dynamic secrets (OAuth `access_token` / `refresh_token`, DCR-registered client) live in a private in-process token cache owned by the registry.** The cache is never exposed; persistence across process restarts is the operator's choice via opt-in callbacks on the auth config.

```ts
// Per-mode auth shape; `tokens`, `client`, and the callbacks only apply
// to the OAuth modes that produce or refresh that material.
auth: {
  mode: `apiKey`,
  key: process.env.X_API_KEY,
  headerName: `X-...`,
}

auth: {
  mode: `clientCredentials`,
  tokenUrl: `https://auth.example.com/oauth/token`,
  clientId: process.env.X_CLIENT_ID,
  clientSecret: process.env.X_CLIENT_SECRET,
  scopes: [`mcp:read`],
}

auth: {
  mode: `authorizationCode`,
  flow: `browser`,                                          // or `device`
  scopes: [`mcp:read`],
  client?: { clientId, clientSecret? },                     // optional, skip DCR
  tokens?: { accessToken, refreshToken?, expiresAt? },      // optional, skip OAuth flow on boot
  onTokensChanged?: (tokens) => void | Promise<void>,       // fires on initial auth + every refresh
  onClientRegistered?: (client) => void | Promise<void>,    // fires once after DCR
}
```

The SDK's `OAuthClientProvider` is wired internally to the registry's private cache; the developer never sees it. The provider does PKCE, RFC 9728 discovery, RFC 7591 DCR, token exchange, refresh, and 401-retry. Our code only:

- Tells the SDK where to send the user for the authorize step (the runtime's public URL + `/oauth/callback/<server>`).
- Receives the callback, hands the code to `provider.finishAuth(code)`.
- Updates the private cache and fires `onTokensChanged` / `onClientRegistered` if the operator wired them.

### Persistence presets

For operators who want OAuth tokens to survive process restarts, `agents-mcp` ships two small opt-in helpers that produce the auth-config slice. Each is a one-line spread at the call site.

| Helper                              | Backing store                                                                                                       | When to use                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `keychainPersistence({ server })`   | OS keychain via `keytar` (macOS Keychain / libsecret / Windows Credential Manager); no-op when keytar isn't present | Local dev on a workstation; tokens encrypted by the OS               |
| `filePersistence({ path, server })` | JSON file, mode `0600`                                                                                              | CI / minimal containers without an OS keychain; deterministic backup |

Each helper returns `{ tokens?, client?, onTokensChanged, onClientRegistered }` — the exact shape the auth config expects. Usage:

```ts
const honeycomb = await keychainPersistence({ server: `honeycomb` })

await mcpRegistry.addServer({
  name: `honeycomb`,
  transport: `http`,
  url: `https://mcp.honeycomb.io/mcp`,
  auth: {
    mode: `authorizationCode`,
    flow: `browser`,
    scopes: [`mcp:read`],
    ...honeycomb,
  },
})
```

If neither helper is wired, OAuth tokens live only for the lifetime of the process — `dev.sh restart` sends the developer back through the Authorize button. That's an acceptable default for the "developer owns persistence" model: the SDK doesn't decide where their secrets sleep.

For Vault / SSM / a custom secret system, the operator writes their own `onTokensChanged` and `onClientRegistered` directly. There is no `CredentialStore` interface to extend; the contract is two callbacks and two optional values.

### What's gone

The earlier design exposed a `CredentialStore` interface plus five public store implementations (`inMemoryCredentialStore`, `envCredentialStore`, `fileCredentialStore`, `osKeychainCredentialStore`, `composedCredentialStore`) and required the embedder to compose them at bootstrap. All of that is removed:

- `CredentialStore` is no longer a public type.
- All five built-in stores are removed from the public surface; the keychain and file behaviours live on as the persistence presets above.
- `createRegistry` no longer accepts a `credentials` option.
- Static secrets that previously came from `envCredentialStore`'s opinionated naming convention (`MCP_<SERVER>_API_KEY`, etc.) now come from inline auth-config fields. The developer reads `process.env` themselves at the call site.

The internal token cache used by the registry is the same data structure as the old `inMemoryCredentialStore`, just no longer crossing the public boundary. Tests use a small `testCredentials` helper kept under `test/helpers/`.

### Per-agent allowlist

Agent definitions opt into MCP servers explicitly:

```ts
import { mcp } from '@electric-ax/agents-runtime'

defineEntity('horton', {
  // ...
  tools: [
    createBashTool(),
    createReadFileTool(),
    ...mcp.tools(['sentry', 'github']), // explicit list
    // or: ...mcp.tools('*')              // all registered servers
  ],
})
```

Resolved tool set is recorded in the agent's manifest at compose time. Tools are exposed to the model with always-prefixed names following Anthropic's tool-name regex `^[a-zA-Z0-9_-]{1,128}$`: `mcp__sentry__search`, `mcp__github__create_issue`, etc.

### OAuth callback

The runtime-hosting process exposes (mounted by `mountMcpHttp`):

- `GET /oauth/callback/:server` — completes browser-redirect flow. Hands the code to the SDK's `OAuthClientProvider.finishAuth(code)`, which performs PKCE-protected token exchange, persists the token set via the `CredentialStore.saveOAuthTokens` callback, and renders a success page.
- `POST /oauth/device/:server/start` — initiates device flow; returns user code + verification URL for the catalog UI to display.

The OAuth provider's redirect URI is `${RUNTIME_PUBLIC_URL}/oauth/callback/<server>` (or `auth.redirectUri` from `mcp.json` when set) — the browser redirects directly to the runtime, bypassing agents-server entirely.

### Hot-reload semantics

Changes to `mcp.json` (or `runtime.registerMcpServer` / `unregisterMcpServer`) take effect immediately:

- **New server:** tools available at the next tool-selection step in any active wake; manifest of agents using `mcp.tools('*')` updates at next compose.
- **Removed server:** in-flight tool calls complete or fail cleanly; no new calls dispatch; stdio subprocess terminates after in-flight calls drain.
- **Reconfigured server:** takes effect on the next tool call to that server. In-flight calls finish on the old config.

## Connected Services UI

A new page in agents-server-ui listing all registered servers. Each row shows:

- **Name and transport** (stdio / http).
- **Auth mode** (apiKey / clientCredentials / authorizationCode).
- **Status** — one of:
  - `healthy` — token valid, recent successful call.
  - `expiring` — token within configurable window of expiry, refresh expected to succeed silently.
  - `needs_auth` — no credential in vault, or refresh failed.
  - `error` — server returned errors recently (other than auth).
  - `disabled` — operator paused the server.
- **Last successful call / refresh** timestamp.
- **Per-row actions:** `Authorize` / `Re-authorize` / `Disconnect` / `Disable` / `Enable`.
- **Device-flow detail** — when an in-progress device flow exists, the user code + verification URL.

The catalog is the operator's primary mechanism for noticing and fixing broken credentials, and the developer's primary surface for kicking off initial OAuth flows.

## MCP spec conformance

We follow the MCP authorization spec for HTTP servers:

- OAuth 2.1 with PKCE (S256).
- Dynamic Client Registration (RFC 7591).
- Protected Resource Metadata (RFC 9728).
- Resource Indicators (RFC 8707).
- Streamable HTTP transport per the current spec.

We add device-code grant (RFC 8628) as a first-class flow alongside browser-redirect — better fit for headless / webhook-spawned / remote-runtime contexts where there's no developer-at-a-browser.

## Failure handling

The runtime returns a structured error to the agent's model on any tool-call failure it can't transparently recover from. Categories the model may see:

- `auth_unavailable` — silent refresh failed and no credential is usable; the operator/developer must reauthorize via the catalog.
- `transport_error` — server unreachable, connection dropped, malformed response.
- `timeout` — call exceeded its per-call timeout.
- `server_error` — the MCP server returned a structured error.
- `tool_not_found` — capability mismatch (e.g. server's tool list changed since compose).

Agents are expected to handle these like any other tool error: retry, fall back, give up gracefully, or escalate to the user. The runtime does not block tool calls indefinitely waiting for out-of-band recovery.

## Project risks and mitigations

| Risk                                                             | Mitigation                                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Refresh-token race across wakes                                  | Per-`(server, scope)` mutex around the refresh exchange; runtime owns the credential.                                        |
| Vault file leaks if file permissions wrong                       | Default implementation enforces `chmod 600`; refuses to read wider modes; encryption-at-rest where OS keychain is available. |
| Hot-reload causes user confusion when tool list changes mid-wake | Manifest snapshot at compose time records what the agent saw; catalog shows live truth.                                      |
| Stdio + personal credentials confused for a deployment pattern   | Documentation prominently scopes it as local-dev only.                                                                       |
| Untrusted MCP servers leak data or inject prompts                | Out of scope for runtime; operators register only trusted servers; catalog surfaces registered tool descriptions for audit.  |

## Rollout plan

1. **Phase 1 — registry and bridge.** MCP Registry (with `mcp.json` loading and file-watch), key vault interface + file-on-disk default, stdio + HTTP bridge with per-call timeouts, per-agent allowlist, hot-reload of newly-added servers. `apiKey` mode only. Agents can call MCP tools given a pre-configured API key.
2. **Phase 2 — OAuth.** OAuth Coordinator with PKCE/DCR, browser-redirect flow, silent refresh with per-`(server, scope)` mutex. `clientCredentials` and `authorizationCode (browser)`.
3. **Phase 3 — UI.** Connected Services page with server status, per-row actions, and surfaces for kicking off OAuth flows.
4. **Phase 4 — device-code flow.** Add `authorizationCode (device)`; surface user code + verification URL on the catalog.

## Open questions

- **Stdio process resource limits.** Default off in v1.
- **Vault rotation.** Mechanics of rotating an `apiKey` while in-flight calls are using it — confirm a clean swap.
- **Schema validator severity.** Should `authorizationCode` mode for an unattended-flagged workflow be a warning or a hard error? Probably warning until we have user feedback.
- **Catalog page for `mcp.tools('*')` agents.** Show the resolved set as of last compose, or always the live set? Probably last compose, with a note.
- **Per-call timeout default.** 30s is a starting point; revisit based on what real MCP servers in the ecosystem do.

## Process boundaries and where credentials live

Two processes are involved in any deployment that uses the
durable-streams + Postgres backbone (which is the default):

- **`agents-server`** — hosts the UI, owns Postgres, Electric, durable
  streams, and the entity bridge. Holds an in-memory list of registered
  runtimes (`name`, `publicUrl`, `types[]`) populated by the type-
  registration handshake. Serves `/api/runtimes` for UI discovery.
  **Holds no MCP state, no credentials, no OAuth coordinator.**

- **The runtime-hosting process** — runs `agents-runtime` and the
  user's agent definitions (e.g. `packages/agents`, or any custom
  embedder). Sole owner of the live MCP registry, the
  `CredentialStore`, and all connections to MCP servers. Mounted at
  a publicly-reachable URL so OAuth providers and the UI can both
  reach it.

**Credentials live in the runtime-hosting process. They never leave it.**
agents-server is not in the data path for MCP — the UI talks to the
runtime directly (CORS-allowlisted), and OAuth providers redirect
directly to `${RUNTIME_PUBLIC_URL}/oauth/callback/<server>`.

Why this matters:

- Single source of truth for tokens and tool state. No cross-process
  sync, no proxy invalidation, no second coordinator to race against.
- A compromise of agents-server doesn't expose user credentials.
- New runtime embedders get MCP for free — they mount `mountMcpHttp`,
  announce their `publicUrl`, and the UI picks them up via discovery.

The trade-off: the runtime needs a public URL the browser can reach.
For local dev that's just `http://localhost:4448`. For deployed setups
the operator provides one (typically a sibling host or a path prefix
on the same load balancer). This is a deployment requirement of the
experimental cut; future iterations may relax it (e.g. tunnel the
callback through agents-server, or use the durable-streams shape
pattern so the UI never needs a runtime URL at all).

### Tool-provider injection (no per-agent wiring)

`agents-runtime` exposes `registerToolProvider({ name, tools })`. The
runtime's wake-time tool composition appends every registered
provider's tools to whatever the entity type declared statically. The
bootstrap registers an MCP provider once:

```ts
registerToolProvider({ name: `mcp`, tools: () => mcpHandle.tools() })
```

After that, every entity type — `horton`, `worker`, `coding-agent`,
and any future addition — sees MCP tools transparently. Agent
definitions don't import or mention `agents-mcp`.

## Appendix: prior-art summary

(Distilled from a research scan of Claude Code, Cursor, Cline, Continue.dev, Windsurf, Zed, Codex CLI, Aider, VS Code, and Goose, conducted while drafting this design.)

- **No coding agent has a real Connected Services catalog.** Several open issues in Claude Code trace directly to its absence ([#30272](https://github.com/anthropics/claude-code/issues/30272), [#18442](https://github.com/anthropics/claude-code/issues/18442)).
- **Refresh-token races bite multi-session agents.** [Claude Code #24317](https://github.com/anthropics/claude-code/issues/24317).
- **Goose's keychain-first credential storage** with env-var override and file fallback is the cleanest pattern in the field.
- **Claude Code's `.mcp.json` + `~/.claude.json` split** (committed team manifest + personal credential overlay) is the strongest onboarding pattern.
- **Device-code flow** (Goose) is friendlier than browser-redirect for headless contexts.
