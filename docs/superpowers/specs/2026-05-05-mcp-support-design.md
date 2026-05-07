# MCP Support for Electric Agents — Design Spec

**Status:** Draft — **Experimental feature**
**Date:** 2026-05-05 (last revised 2026-05-07)
**Author:** Valter Balegas (with Claude)

> **Experimental.** This is the first cut of MCP integration. We expect to evolve the registration model (e.g. stream-based registration via the existing `entity_types` shape pattern, server-side delegated discovery, multi-tenant credential scopes) once the design has been used in anger. Public surfaces marked here may change without a deprecation cycle while the feature carries the experimental flag.

> **2026-05-07 revision.** The spec was originally written around an
> HTTP-exposed runtime with a public `CredentialStore` and polled UI
> state. The implementation collapsed that into an Electron-embedded
> runtime with push-based IPC and operator-owned persistence. This
> revision rewrites the architecture, runtime-discovery, OAuth-callback,
> Connected Services UI, and process-boundaries sections to match what
> shipped on `balegas/mcp-impl-v2`. The "What's gone" subsection inside
> "Credential handling" intentionally retains the prior contract for
> readers tracking the change.

## Summary

Add Model Context Protocol (MCP) support to Electric Agents so agents can call tools and read data from external MCP servers — both locally-spawned stdio servers and remote HTTP servers — with credentials managed by the runtime.

## Goals

- Agents can call MCP tools from servers declared in runtime config.
- Both stdio (local subprocess) and Streamable HTTP transports.
- All three credential modes: API key, OAuth client credentials, OAuth authorization code (browser-redirect).
- Silent token refresh on every call where possible. When silent refresh isn't possible, the tool call returns a structured error to the agent's model.
- Per-call timeouts so a misbehaving or slow server can't hang a wake.
- A desktop UI surface (agents-server-ui inside the Electron app) showing server health and providing reauth actions.
- Servers added/removed/reconfigured at runtime are visible to running agents within the same wake.
- Persistence across process restarts is operator-owned via opt-in callbacks on the auth config — the runtime exposes no public credential-store interface.

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
│   Electron desktop process (the v1 deployment target)            │
│                                                                  │
│  ┌─────────────────────────┐   ┌───────────────────────────┐    │
│  │  Main process           │   │  Renderer (agents-       │    │
│  │  - Spawns the embedded  │   │  server-ui)              │    │
│  │    BuiltinAgentsServer  │   │  - Subscribes to MCP     │    │
│  │  - Subscribes to        │◄──┤    snapshots over IPC    │    │
│  │    Registry.subscribe() │   │  - Sends action verbs    │    │
│  │  - Broadcasts snapshots │──►│    (authorize, reconnect,│    │
│  │    on `desktop:mcp-     │   │    disable, enable) over │    │
│  │    state` IPC           │   │    `desktop:mcp-*` IPC   │    │
│  │  - Hosts OAuth          │   │                          │    │
│  │    BrowserWindow        │   └───────────────────────────┘    │
│  │    (intercepts          │                                     │
│  │    redirect_uri)        │                                     │
│  └────────────┬────────────┘                                     │
│               │ in-process                                       │
│  ┌────────────▼─────────────────────────────────────────────┐   │
│  │  BuiltinAgentsServer (agents-runtime + Registry)         │   │
│  │                                                          │   │
│  │  ┌────────────────────┐   ┌─────────────────────────┐   │   │
│  │  │  MCP Registry      │   │ Internal AuthStore      │   │   │
│  │  │  - mcp.json +      │   │ (private; per-registry) │   │   │
│  │  │    addServer()     │   │ - in-memory token cache │   │   │
│  │  │  - Idempotent on   │   │ - per-server hooks fire │   │   │
│  │  │    (name,url,auth) │   │   onTokensChanged /     │   │   │
│  │  │  - subscribe(handler│   │   onClientRegistered   │   │   │
│  │  │    ): RegistrySnap- │   │   if operator wired    │   │   │
│  │  │    shot stream      │   │   them via auth config │   │   │
│  │  │  - openAuthorizeUrl │   └─────────────────────────┘   │   │
│  │  │    hook (called by  │   ┌─────────────────────────┐   │   │
│  │  │    main to open     │   │ SDK OAuthClientProvider │   │   │
│  │  │    BrowserWindow)   │   │ - PKCE / DCR / RFC 9728 │   │   │
│  │  │  - Manages stdio    │   │ - Refresh / 401-retry   │   │   │
│  │  │    subprocesses     │   │ - Backed by AuthStore   │   │   │
│  │  └────────┬───────────┘   └─────────────────────────┘   │   │
│  │           │                                             │   │
│  │  ┌────────▼─────────────────────────────────────────┐  │   │
│  │  │  MCP Bridge (per-tool-call)                       │  │   │
│  │  │  - SDK transport with OAuthClientProvider         │  │   │
│  │  │  - Routes call (stdio JSON-RPC / Streamable HTTP) │  │   │
│  │  │  - Enforces per-call timeout                      │  │   │
│  │  │  - On unrecoverable failure: structured error     │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

The agents-runtime tool-provider hook auto-injects MCP tools into every
entity-type's tool list at wake time — no per-agent wiring.

### Embedding model

`agents-mcp` is a Node library. The desktop app is the v1 embedder; it
wraps the registry with Electron-specific glue (BrowserWindow OAuth
interception + IPC broadcast). The library is embedder-agnostic — a
deployed-runtime embedder could mount its own HTTP routes against the
`Registry` interface — but `agents-mcp` no longer ships an
`mountMcpHttp` helper or any built-in HTTP/OAuth-callback surface.
That path was tried, then removed in favour of in-process embedding;
operators wanting it back write the routes themselves.

### Push-based state (registry → renderer)

The registry is the single source of truth for MCP state. State sync
to the UI is push-based and travels over Electron IPC:

1. **Subscribe.** On runtime startup, the Electron main process calls
   `registry.subscribe((snapshot) => broadcast(snapshot))`. The
   handler fires synchronously with the current state, then on every
   mutation: `addServer`, `removeServer`, `applyConfig`, `finishAuth`,
   `reauthorize`, `disable`, `enable`, and every connection-state
   transition during `connectAndList`.

2. **Broadcast.** Main sends each snapshot over the
   `desktop:mcp-state` IPC channel to every BrowserWindow.

3. **Render.** The `useMcpServersIpc` hook in the renderer holds the
   latest snapshot and renders the Connected Services page from it.
   `getSnapshot()` is provided as a one-shot fallback so the page can
   render before the first push event arrives.

The snapshot envelope is `{ seq: number, servers: ListedEntry[] }`.
`seq` is monotonic per-registry — useful for downstream dedup or
"I have seq N already" checks.

#### Why this closes the "tool count always 0" gap

The renderer reads from the same registry that owns the live tools.
There is no second copy to keep in sync, no proxy state to invalidate,
no polling cadence to tune. Disable / enable / reauthorize hit the
actual registry, so they stop being cosmetic.

#### Auth on the IPC surface

The desktop embedding has no cross-process auth concern — IPC is the
process boundary. A future deployed-runtime embedding that exposes
HTTP routes against the registry would own its own auth model;
`agents-mcp` does not prescribe one.

### Package boundaries

| Concern                                                                         | Package            | Notes                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry, transports, bridges, OAuthClientProvider adapter, persistence helpers | `agents-mcp`       | Self-contained Node lib. Public surface: `Registry` interface (incl. `subscribe`), `bridgeMcpTool`, `keychainPersistence` / `filePersistence`. No HTTP, no UI glue.     |
| Tool-provider injection at wake time                                            | `agents-runtime`   | Tiny hook: `registerToolProvider({ name, tools })` — providers run at compose time. No per-agent wiring.                                                                |
| Bootstrap wiring inside the embedded runtime                                    | `packages/agents`  | Constructs the `Registry`, exposes it via `BuiltinAgentsServer.mcpRegistry`, accepts an `openAuthorizeUrl` callback for embedders to launch the OAuth UI.               |
| OAuth BrowserWindow + IPC broadcast + IPC action verbs                          | `agents-desktop`   | Subscribes to `mcpRegistry`, broadcasts snapshots on `desktop:mcp-state`, hosts the sandboxed OAuth window, exposes `desktop:mcp-{authorize,reconnect,disable,enable}`. |
| Settings → MCP Servers page                                                     | `agents-server-ui` | Desktop-only; hooks onto `electronAPI.mcp.onState`. Hidden in non-Electron builds.                                                                                      |

### Transports and where they run

| Transport           | Where runs                                                   | Notes                                                                                                      |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **stdio**           | Subprocess of the agents-server runtime, on the runtime host | Lazy-spawned on first tool call; one process per server; multiplexed via JSON-RPC `id`; restarted on crash |
| **Streamable HTTP** | Anywhere network-reachable                                   | Single HTTP endpoint per spec; server-pushed messages over SSE inside the response stream                  |

In local-dev, the runtime is the developer's machine, so stdio servers can read local user credentials (e.g. an existing `gh` CLI token via env). In a server-hosted deployment, the runtime is on the agents-server host; stdio servers there are inherently shared/system-level. **Stdio + personal credentials is a local-dev pattern, not a deployment pattern** — documented prominently.

### Credential model

Three auth modes per server:

| Mode                | Initial setup                                                                                     | Steady state                                             | Operator action when fails |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| `apiKey`            | Operator passes the key inline in `auth.key`                                                      | Never expires until rotated                              | Rotate key                 |
| `clientCredentials` | Operator passes `clientId` + `clientSecret` inline                                                | Runtime exchanges for short-lived access tokens silently | Rotate client secret       |
| `authorizationCode` | Browser flow in a sandboxed Electron BrowserWindow → user approves → main intercepts the redirect | Silent refresh on each use; refresh tokens rotate        | Re-authorize via the page  |

The mode is declared per server in `mcp.json`. Picking `authorizationCode` for a server an unattended workflow needs is a configuration smell — the schema validator should warn (and the docs should call it out). Device-code flow (RFC 8628) is not currently part of the public surface; an experimental device-flow path was prototyped but removed pending a concrete need in a non-desktop deployment.

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

Operators can register MCP servers either declaratively (in `mcp.json`) or programmatically. Both produce the same `Registry` entries and use the same inline `auth` shape for credentials and persistence callbacks.

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
        "scopes": ["mcp:read", "mcp:write"],
      },
    },
    "linear": {
      "transport": "http",
      "url": "https://mcp.linear.app/sse",
      "auth": {
        "mode": "authorizationCode",
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

`mcp.json` declares structural shape only. Static secrets and persistence callbacks are added at the call site — programmatic embedders read `mcp.json`, then layer in `auth.key` / `auth.tokens` / `auth.onTokensChanged` etc. before passing each entry to `addServer`. See "Credential handling" below for the inline shape.

**Programmatic — runtime API** (advanced cases)

```ts
import { runtime } from '@electric-ax/agents-runtime'

const result = await runtime.mcp.addServer({
  name: 'temp-stripe',
  transport: 'http',
  url: 'https://mcp.stripe.com/mcp',
  auth: {
    mode: 'apiKey',
    headerName: 'Authorization',
    key: process.env.STRIPE_MCP_KEY!, // inline; embedder owns the lookup
  },
})

if (result.state === `authenticating`) {
  // Surface result.authUrl to the user (the desktop embedder opens it
  // in a sandboxed BrowserWindow automatically via the registry's
  // openAuthorizeUrl hook).
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

For mTLS, pre-registered DCR clients, OIDC quirks, or any auth-server idiosyncrasy not covered by the standard `auth` shape, callers can supply a fully-formed MCP-SDK `OAuthClientProvider` per server. This bypasses the registry's internal auth cache for that one server entirely:

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

Programmatic registration is useful for agents that spin up servers in response to user actions (e.g. a coding-agent starting a project-scoped MCP server for the duration of a task). The same inline `auth` shape and persistence callbacks apply to both creation modes.

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
  scopes: [`mcp:read`],
  client?: { clientId, clientSecret? },                     // optional, skip DCR
  tokens?: { accessToken, refreshToken?, expiresAt? },      // optional, skip OAuth flow on boot
  onTokensChanged?: (tokens) => void | Promise<void>,       // fires on initial auth + every refresh
  onClientRegistered?: (client) => void | Promise<void>,    // fires once after DCR
}
```

The SDK's `OAuthClientProvider` is wired internally to the registry's private cache; the developer never sees it. The provider does PKCE, RFC 9728 discovery, RFC 7591 DCR, token exchange, refresh, and 401-retry. Our code only:

- Hands the SDK-issued authorize URL to the embedder via the registry's `openAuthorizeUrl` hook. The desktop embedder opens it in a sandboxed `BrowserWindow` and watches `webContents.on('will-redirect')` for the configured redirect URI; the redirect is cancelled before the renderer actually fetches it, so no HTTP listener is needed.
- Calls `registry.finishAuth(server, code, state)` with the intercepted code+state, which runs the SDK token exchange under the hood.
- Updates the private cache and fires `onTokensChanged` / `onClientRegistered` if the operator wired them.

### Persistence presets

For operators who want OAuth tokens to survive process restarts, `agents-mcp` ships two small opt-in helpers that produce the auth-config slice. Each is a one-line spread at the call site.

| Helper                              | Backing store                                                                                                                                | When to use                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `keychainPersistence({ server })`   | OS keychain by shelling out (macOS `security` / Linux `secret-tool`); throws on Windows or when no backend is found. No native dependencies. | Local dev on a workstation; tokens encrypted by the OS               |
| `filePersistence({ path, server })` | JSON file, mode `0600`                                                                                                                       | CI / minimal containers without an OS keychain; deterministic backup |

Each helper returns `{ tokens?, client?, onTokensChanged, onClientRegistered }` — the exact shape the auth config expects. Usage:

```ts
const honeycomb = await keychainPersistence({ server: `honeycomb` })

await mcpRegistry.addServer({
  name: `honeycomb`,
  transport: `http`,
  url: `https://mcp.honeycomb.io/mcp`,
  auth: {
    mode: `authorizationCode`,
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

The runtime exposes no HTTP endpoint for the OAuth callback. Completion of the browser-redirect flow is handled by the embedder.

**Desktop embedder.** The Electron main process subscribes to `registry.subscribe()` and accepts an `openAuthorizeUrl(url, server)` hook on the registry options. When the registry produces an authorize URL (initial sign-in or `reauthorize`), main opens it in a sandboxed `BrowserWindow` and listens on `webContents.on('will-redirect')` (and `'will-navigate'` as a backup). When a navigation begins to a URL starting with the configured redirect-URI prefix (e.g. `http://localhost:4448/oauth/callback/<server>`), main:

1. Calls `event.preventDefault()` — the redirect URL is never actually fetched, so no HTTP listener is needed.
2. Extracts `code` and `state` from the query string.
3. Calls `registry.finishAuth(server, code, state)`, which runs the SDK token exchange and fires the operator's persistence callbacks.

The redirect-URI value is therefore a sentinel, not a network address. We reuse the conventional shape (`${publicUrl}/oauth/callback/<server>`) so the SDK's PKCE state stays well-formed.

**Other embedders.** A deployed-runtime embedder that wants the classic browser-then-HTTP-callback shape mounts its own `GET /oauth/callback/:server` route against the registry: read `code` + `state` from the request, call `registry.finishAuth(...)`. `agents-mcp` does not ship this route by default.

Device-code grant (RFC 8628) is not currently surfaced in the public API — see "Credential model" above.

### Hot-reload semantics

Changes to `mcp.json` (or `runtime.registerMcpServer` / `unregisterMcpServer`) take effect immediately:

- **New server:** tools available at the next tool-selection step in any active wake; manifest of agents using `mcp.tools('*')` updates at next compose.
- **Removed server:** in-flight tool calls complete or fail cleanly; no new calls dispatch; stdio subprocess terminates after in-flight calls drain.
- **Reconfigured server:** takes effect on the next tool call to that server. In-flight calls finish on the old config.

## Connected Services UI

Settings → MCP Servers, in agents-server-ui. **Desktop-only:** in non-Electron builds, the sidebar entry is hidden and the page renders a hint to launch the desktop app. Each row shows:

- **Name and transport** (stdio / http).
- **Auth mode** (apiKey / clientCredentials / authorizationCode).
- **Status** — one of (mirrors `Registry.list()` / `ListedEntry.status`):
  - `connecting` — transport is being established.
  - `authenticating` — OAuth flow needed; `authUrl` is set, browser window has been opened.
  - `ready` — connected; tools listed.
  - `error` — connect or transport failure; `error.kind` + `error.message` are surfaced.
  - `disabled` — operator paused the server.
- **Tool count + expandable tool list** (name + description per tool).
- **Per-row actions:**
  - **Authorize / Re-authorize** — visible whenever the server's `authMode` is `authorizationCode`. Calls `Registry.reauthorize(name)`, which closes the transport, drops the in-memory tokens, and rebuilds the entry in place (no flicker), causing the SDK to surface a fresh authorize URL.
  - **Reconnect** — drops the transport and re-runs `addServer(entry.config)`; tokens stay put.
  - **Disable / Enable** — pause/resume the server. Tokens stay put either way.

There is no "Disconnect" action: removal is the wrong inverse of "connect," because the only path back from a removed entry is a config edit. Pause via Disable is the recoverable equivalent. Removing entries entirely from the registry happens via the operator editing `mcp.json`.

The page is the operator's primary mechanism for noticing and fixing broken credentials, and the developer's primary surface for kicking off initial OAuth flows.

## MCP spec conformance

We follow the MCP authorization spec for HTTP servers:

- OAuth 2.1 with PKCE (S256).
- Dynamic Client Registration (RFC 7591).
- Protected Resource Metadata (RFC 9728).
- Resource Indicators (RFC 8707).
- Streamable HTTP transport per the current spec.

Device-code grant (RFC 8628) is not in the current public surface — see "Credential model" for the rationale. We may add it back if a non-desktop deployment needs it.

## Failure handling

The runtime returns a structured error to the agent's model on any tool-call failure it can't transparently recover from. Categories the model may see:

- `auth_unavailable` — silent refresh failed and no credential is usable; the operator/developer must reauthorize via the catalog.
- `transport_error` — server unreachable, connection dropped, malformed response.
- `timeout` — call exceeded its per-call timeout.
- `server_error` — the MCP server returned a structured error.
- `tool_not_found` — capability mismatch (e.g. server's tool list changed since compose).

Agents are expected to handle these like any other tool error: retry, fall back, give up gracefully, or escalate to the user. The runtime does not block tool calls indefinitely waiting for out-of-band recovery.

## Project risks and mitigations

| Risk                                                             | Mitigation                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh-token race across wakes                                  | Per-`(server, scope)` mutex around the refresh exchange; runtime owns the credential.                                                     |
| Persisted token file leaks if file permissions wrong             | `filePersistence` writes mode `0600` and refuses to read wider modes; `keychainPersistence` defers encryption-at-rest to the OS keychain. |
| Hot-reload causes user confusion when tool list changes mid-wake | Manifest snapshot at compose time records what the agent saw; catalog shows live truth.                                                   |
| Stdio + personal credentials confused for a deployment pattern   | Documentation prominently scopes it as local-dev only.                                                                                    |
| Untrusted MCP servers leak data or inject prompts                | Out of scope for runtime; operators register only trusted servers; catalog surfaces registered tool descriptions for audit.               |

## Rollout plan

What shipped on `balegas/mcp-impl-v2`:

1. **Registry and bridge.** MCP Registry with `mcp.json` loading + file-watch, stdio + HTTP transports with per-call timeout / cancellation / progress, per-agent allowlist, hot-reload, idempotent re-add. `apiKey` mode end-to-end.
2. **OAuth (browser).** SDK-backed `OAuthClientProvider` adapter with PKCE / RFC 7591 DCR / RFC 9728 discovery / RFC 8707 resource indicators / silent refresh / 401-retry. `clientCredentials` and `authorizationCode` modes.
3. **Push-based state.** `Registry.subscribe(handler)` emits monotonic snapshots on every mutation; `Registry.reauthorize(name)` rebuilds an entry in place to avoid UI flicker on re-auth.
4. **Persistence presets.** `keychainPersistence` (macOS / Linux, no native deps) and `filePersistence` (mode-0600 JSON) — both produce auth-config slices via callbacks. The public `CredentialStore` surface was removed.
5. **Desktop integration.** `agents-desktop` opens authorize URLs in a sandboxed `BrowserWindow` and intercepts the redirect URI client-side; broadcasts registry snapshots to all renderer windows; exposes IPC action verbs (`authorize`, `reconnect`, `disable`, `enable`).
6. **Settings → MCP Servers.** Single flat list driven by `useMcpServersIpc`; gated on Electron; sidebar entry hidden on web.

A device-code path (RFC 8628) and an HTTP `mountMcpHttp` surface were both prototyped earlier on this branch and removed when the desktop-IPC architecture made them unnecessary. Either can be reinstated for a non-desktop embedder when a use case arrives.

## Open questions

- **Stdio process resource limits.** Default off in v1.
- **API-key rotation.** Mechanics of rotating an `apiKey` while in-flight calls are using it — confirm a clean swap when `applyConfig` re-applies a changed `auth.key`.
- **Schema validator severity.** Should `authorizationCode` mode for an unattended-flagged workflow be a warning or a hard error? Probably warning until we have user feedback.
- **Catalog page for `mcp.tools('*')` agents.** Show the resolved set as of last compose, or always the live set? Probably last compose, with a note.
- **Per-call timeout default.** 30s is a starting point; revisit based on what real MCP servers in the ecosystem do.

## Process boundaries and where credentials live

The v1 deployment target is the Electron desktop app. There is one OS
process (the Electron main process) hosting:

- **The renderer (agents-server-ui)** in a sandboxed `BrowserWindow`,
  with `contextBridge`-exposed IPC verbs and no Node access.
- **The agents runtime** (`BuiltinAgentsServer`) running in-process in
  main, owning the `Registry`, the private auth cache, all MCP
  transports (stdio subprocesses + HTTP clients), and the SDK
  `OAuthClientProvider`.
- **The OAuth window** — a separate sandboxed `BrowserWindow` opened
  on demand to host the auth provider's login page; main intercepts
  the redirect URI before the renderer ever fetches it.

**Credentials live in the runtime owned by main. They never leave it.**
The renderer reads its view of MCP state via push-based IPC snapshots;
it has no access to tokens, the auth cache, or transport handles.
OAuth providers redirect to a sentinel URL inside the OAuth window —
never to a real network endpoint — and main extracts the code from
the navigation event.

Why this matters:

- Single source of truth for tokens and tool state. No cross-process
  sync, no second coordinator to race against, no HTTP listener that
  could be exploited.
- The renderer's IPC surface is a small, explicit allowlist:
  `desktop:mcp-{snapshot,state,authorize,reconnect,disable,enable}`.
  Anything else stays in main.
- Tests against the registry are pure Node — no Electron required —
  because the registry knows nothing about IPC; it just emits
  snapshots through `subscribe(handler)`.

Trade-offs and the deployed-runtime case:

- This shape ties first-class MCP management to the desktop app. The
  web build of agents-server-ui (no `electronAPI`) hides the page and
  shows a hint to launch the desktop app.
- A future deployed-runtime embedder (HTTP-only, multi-user) can wrap
  the same `Registry` with its own HTTP routes for state and OAuth
  callback handling, plus its own auth model on those routes.
  `agents-mcp` keeps the registry embedder-agnostic for that path.

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
