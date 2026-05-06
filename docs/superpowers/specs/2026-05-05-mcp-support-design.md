# MCP Support for Electric Agents — Design Spec

**Status:** Draft
**Date:** 2026-05-05
**Author:** Valter Balegas (with Claude)

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
┌─────────────────────────────────────────────────────────────────┐
│                       agents-server                              │
│                                                                  │
│  ┌─────────────────────┐  ┌────────────────────────────────┐    │
│  │  MCP Registry       │  │  Key Vault (pluggable)         │    │
│  │  - Loads mcp.json   │  │  - get/set/delete by ref       │    │
│  │  - Watches changes  │  │  - Default: file-on-disk       │    │
│  │  - Manages stdio    │  │  - Future: HC Vault, AWS SM    │    │
│  │    subprocesses     │  └────────────────────────────────┘    │
│  └──────────┬──────────┘  ┌────────────────────────────────┐    │
│             │             │  OAuth Coordinator             │    │
│             │             │  - PKCE / DCR / device-code    │    │
│             │             │  - Refresh exchange (mutex)    │    │
│             │             │  - Callback endpoint           │    │
│             │             └────────────────────────────────┘    │
│             │                                                    │
│  ┌──────────▼──────────────────────────────────────────────┐    │
│  │  MCP Bridge (per-tool-call)                             │    │
│  │  - Asks vault for token; runs silent refresh if needed  │    │
│  │  - Routes call (stdio JSON-RPC / Streamable HTTP)       │    │
│  │  - Enforces per-call timeout                            │    │
│  │  - On unrecoverable failure: returns structured error   │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │  server-state events
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    agents-server-ui                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Connected Services page                                 │   │
│  │  - Per-server status (healthy / needs_auth / error)      │   │
│  │  - Authorize / Re-authorize / Disconnect actions         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

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

### Declaration: `mcp.json` + code escape hatch

Primary surface is a JSON config file (default location `mcp.json` at the runtime root, or wherever a runtime config option points). Watched for changes — edits trigger hot-reload.

```jsonc
{
  "servers": {
    "sentry": {
      "transport": "http",
      "url": "https://mcp.sentry.io/v1",
      "auth": {
        "mode": "clientCredentials",
        "clientIdRef": "vault://sentry/client_id",
        "clientSecretRef": "vault://sentry/client_secret",
        "tokenUrl": "https://sentry.io/oauth/token",
      },
    },
    "github": {
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
        "scopes": ["repo", "read:user"],
      },
    },
    "honeycomb": {
      "transport": "http",
      "url": "https://api.honeycomb.io/mcp/",
      "auth": {
        "mode": "apiKey",
        "headerName": "X-Honeycomb-Team",
        "valueRef": "vault://honeycomb/api_key",
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

Code escape hatch for dynamic registration:

```ts
import { runtime } from '@electric-ax/agents-runtime'

runtime.registerMcpServer('linear', {
  transport: 'http',
  url: 'https://mcp.linear.app/v1',
  auth: {
    mode: 'authorizationCode',
    flow: 'browser',
    scopes: ['read', 'write'],
  },
})
```

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

Resolved tool set is recorded in the agent's manifest at compose time. Tools are exposed to the model with always-prefixed names: `sentry.search`, `github.create_issue`, etc.

### Key Vault interface

```ts
interface KeyVault {
  get(ref: string): Promise<string | null>
  set(ref: string, secret: string, opts?: { expiresAt?: Date }): Promise<void>
  delete(ref: string): Promise<void>
  list(prefix?: string): Promise<Array<{ ref: string; expiresAt?: Date }>>
}
```

Default v1 implementation: file-on-disk at `~/.electric-agents/vault.json` (or a runtime-config-pointed path), encrypted at rest with a key from the OS keychain when available, falling back to a file-managed key (with `chmod 600`) when not. Operators can wire alternative implementations via runtime config.

### OAuth callback

agents-server exposes:

- `GET /oauth/callback/:server` — completes browser-redirect flow.
- `POST /oauth/device/:server/start` — initiates device flow, returns user code + verification URL for the catalog UI to display.

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

## v1 scoping note: OAuth UI route wiring

The agents-server provides `mountOAuthRoutes` (`/oauth/callback/:server`,
`POST /api/mcp/servers/:server/authorize`) and `mountStatusRoutes`
(`/api/mcp/servers/...`) modules with full pure-handler test coverage,
but these mounts are **not** wired into agents-server's HTTP dispatch
chain in v1. Wiring them requires a single `OAuthCoordinator` +
`PendingAuthStore` instance that is shared between the agents-server
process (which receives the browser redirect) and the agents process
(whose registry actually mints bearer tokens for tool calls). Today
those run in separate processes with no token-sync channel. Constructing
local-only instances inside agents-server would let UI buttons fire but
silently fail to make tokens visible to the registry — a worse UX than
deferring.

For v1, OAuth flows are exercised via direct curl/test invocations of
the pure handlers; the Connected Services page renders read-only status
and the per-row buttons return 404. Cross-process token sharing
(shared cache via `agents-server` HTTP API, or a co-located deployment
mode) is future work.

## Appendix: prior-art summary

(Distilled from a research scan of Claude Code, Cursor, Cline, Continue.dev, Windsurf, Zed, Codex CLI, Aider, VS Code, and Goose, conducted while drafting this design.)

- **No coding agent has a real Connected Services catalog.** Several open issues in Claude Code trace directly to its absence ([#30272](https://github.com/anthropics/claude-code/issues/30272), [#18442](https://github.com/anthropics/claude-code/issues/18442)).
- **Refresh-token races bite multi-session agents.** [Claude Code #24317](https://github.com/anthropics/claude-code/issues/24317).
- **Goose's keychain-first credential storage** with env-var override and file fallback is the cleanest pattern in the field.
- **Claude Code's `.mcp.json` + `~/.claude.json` split** (committed team manifest + personal credential overlay) is the strongest onboarding pattern.
- **Device-code flow** (Goose) is friendlier than browser-redirect for headless contexts.
