# MCP Support for Electric Agents — Design Spec

**Status:** Draft
**Date:** 2026-05-05
**Author:** Valter Balegas (with Claude)

## Summary

Add Model Context Protocol (MCP) support to Electric Agents so agents can call tools and read data from external MCP servers — both locally-spawned stdio servers and remote HTTP servers — with credentials and OAuth managed durably by the runtime.

Three things differentiate this from existing coding agents' MCP support:

1. A real **Connected Services catalog** in the agents-server-ui that surfaces auth status, last refresh, and per-server actions. No popular agent has this; several have open issues caused by its absence.
2. **Durable pause-on-reauth.** When a tool call hits an expired credential that can't be silently refreshed, the runtime pauses the tool call (no compute consumed), surfaces a reauthorization prompt, and resumes the tool call with the new token when authorization completes. The agent never sees a 401.
3. **Runtime-owned credentials.** The runtime serializes refresh-token use across concurrent wakes, avoiding the single-use-refresh-token race that bites Claude Code and other multi-session agents.

## Goals

- Agents can call MCP tools from servers declared in runtime config.
- Both stdio (local subprocess) and Streamable HTTP transports.
- All three credential modes: API key, OAuth client credentials, OAuth authorization code (browser-redirect and device-code variants).
- Silent token refresh on every call where possible.
- Human-in-the-loop reauth flow that pauses tool calls durably and resumes them on completion.
- Servers added/removed/reconfigured at runtime are visible to running agents within the same wake.
- A web UI surface (agents-server-ui) showing server health and providing reauth actions.
- Pluggable key vault interface; default file-on-disk implementation for v1.

## Non-goals (v1)

- **User identity / per-user credentials.** Electric Agents has no user record today. Credentials are app-scoped: one set of credentials per registered server, shared across all agents in the runtime. Spawn-scoped or user-scoped credentials are deferred until a user identity model exists.
- **Spawn-scoped credentials.** A future addition once identity exists.
- **Active background token refresher.** Reactive refresh-on-use plus the catalog page handle correctness without the moving parts.
- **Suspend-on-`progressToken`.** The durable pause primitive is built once for reauth; wiring `progressToken` into suspend semantics is deferred until a concrete user shows up with a slow MCP server. Pass-through to the timeline (rendering progress events) IS in v1.
- **Legacy SSE transport** (deprecated in the MCP spec).
- **WebSocket or other non-spec transports.**
- **In-process resource limits** for stdio subprocesses. Operators apply limits externally (containerization).

## User stories

### US-1: Automated workflow uses shared system credentials

A honeycomb webhook fires; the runtime spawns an entity tree to investigate. The agent calls the honeycomb MCP server (registered with an API key) and the sentry MCP server (registered with OAuth client_credentials). Neither integration requires a human to be present. Tokens refresh silently on each call. If a credential ever fails (rotation, revocation), the catalog page surfaces it for an on-call operator.

### US-2: Developer-driven workflow uses personal credentials

A developer runs a coding agent locally that needs to push a branch via the GitHub MCP server. The first time the agent calls a GitHub tool, no credential is in the vault. The runtime pauses the tool call and surfaces a reauthorization prompt on the entity timeline (and on the catalog page). The developer clicks "Authorize," completes OAuth in their browser, and the agent resumes — the original `create_pull_request` call returns the actual result. Subsequent calls reuse the stored token and refresh silently.

### US-3: Operator hot-adds an MCP server

While agents are running, an operator edits `mcp.json` to add a new server (e.g. a Linear MCP server). The runtime picks up the change. A running agent's next tool-selection step sees the new tools available without the wake restarting.

### US-4: Operator inspects credential health

An operator visits the Connected Services page in agents-server-ui to see all registered MCP servers, their auth status, last successful token refresh, and any pending reauth prompts. Servers showing `needs_auth` or `expired` can be authorized in place.

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                       agents-server                              │
│                                                                  │
│  ┌─────────────────────┐  ┌────────────────────────────────┐    │
│  │  MCP Registry       │  │  Key Vault (pluggable)         │    │
│  │  - Loads mcp.json   │  │  - get/set/delete by ref       │    │
│  │  - Watches for      │  │  - Default: file-on-disk       │    │
│  │    changes          │  │  - Future: HC Vault, AWS SM    │    │
│  │  - Manages stdio    │  └────────────────────────────────┘    │
│  │    subprocesses     │                                         │
│  └──────────┬──────────┘  ┌────────────────────────────────┐    │
│             │             │  OAuth Coordinator             │    │
│             │             │  - PKCE / DCR / device-code    │    │
│             │             │  - Refresh exchange (mutex)    │    │
│             │             │  - Callback endpoint           │    │
│             │             └────────────────────────────────┘    │
│             │                                                    │
│  ┌──────────▼──────────────────────────────────────────────┐    │
│  │  MCP Bridge (per-tool-call)                             │    │
│  │  - Asks vault for token                                 │    │
│  │  - Routes call (stdio JSON-RPC / Streamable HTTP)       │    │
│  │  - On auth fail: pauses call, emits reauth event        │    │
│  │  - Pass-through progress notifications                  │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                             │
                             │  reauth events / progress events
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    agents-server-ui                              │
│  ┌─────────────────────────┐  ┌──────────────────────────────┐  │
│  │  Entity Timeline         │  │  Connected Services page     │  │
│  │  - Inline reauth prompts │  │  - Per-server status         │  │
│  │  - Progress events       │  │  - Authorize / Re-authorize  │  │
│  └─────────────────────────┘  └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Transports and where they run

| Transport | Where runs | Notes |
|---|---|---|
| **stdio** | Subprocess of the agents-server runtime, on the runtime host | Lazy-spawned on first tool call; one process per server; multiplexed via JSON-RPC `id`; restarted on crash |
| **Streamable HTTP** | Anywhere network-reachable | Single HTTP endpoint per spec; server-pushed messages over SSE inside the HTTP response stream |

In local-dev, the runtime is the developer's machine, so stdio servers can read local user credentials (e.g. an existing `gh` CLI token via env). In a server-hosted deployment, the runtime is on the agents-server host; stdio servers there are inherently shared/system-level (no user identity to attach to). **Stdio + personal credentials is a local-dev pattern, not a deployment pattern** — this should be documented prominently.

### Credential model

Three auth modes per server:

| Mode | Initial setup | Steady state | Operator action when fails |
|---|---|---|---|
| `apiKey` | Operator pastes key into vault | Never expires until rotated | Rotate key |
| `clientCredentials` | Operator pastes `client_id` + `client_secret` | Runtime exchanges for short-lived access tokens silently, every call | Rotate client secret |
| `authorizationCode` (`browser` or `device`) | Browser/device flow → user approves | Silent refresh on each use; refresh tokens rotate | Re-consent |

The mode is declared per server in `mcp.json`. Picking `authorizationCode` for a server that an unattended workflow needs is a configuration smell — the schema validator should warn (and the docs should call it out).

### Pause-on-reauth flow

This is the central novel behavior. Sequence for a single tool call:

1. **Wake N starts.** Agent dispatches `github.create_issue`.
2. **MCP Bridge asks vault for token.** Three branches:
   - Valid access token → call proceeds; tool result returned synchronously.
   - Expired access + valid refresh → bridge runs refresh exchange under per-server mutex; on success, retries with new token; on failure, falls into branch 3.
   - No usable token → enter pause flow.
3. **Pause flow:**
   - Tool call recorded in entity stream as `pending: awaiting_auth`, with metadata `{ server, reason, request_payload }`.
   - Reauth request emitted to two surfaces: entity timeline and Connected Services catalog. Carries OAuth authorization URL (browser flow) or device code + verification URL (device flow).
   - Wake N's other independent work continues; if everything depends on this call, the wake ends.
4. **Entity sleeps** durably. Manifest entry: "wake me when server `<name>` becomes authorized."
5. **Authorization completes** out-of-band:
   - Browser flow: callback hits agents-server `/oauth/callback/<server>`, OAuth Coordinator exchanges code for token, vault stores token, server-state event fires.
   - Device flow: agents-server polls token endpoint with the device code; when authorization completes, vault stores token, event fires.
6. **Wake N+1 fires** with the server-state-changed event. Runtime retries all pending tool calls bound to this server with the new token. Materializes results into the timeline. Runs the agent loop with results in context.

Variations:

- **Coalescing.** Multiple in-flight calls to the same server share one reauth request and all retry on resolution.
- **Multi-server.** Two different servers needing auth produce two reauth requests; the entity wakes when both resolve.
- **TTL.** Pending-auth tool calls have a default 24h TTL. On expiry, the call resolves with an `auth_unavailable` error so the agent can decide what to do (fall back, abort, alert).
- **Concurrent refresh serialization.** Multiple wakes hitting the same near-expiry token: one runs the refresh exchange under a `(server, scope)` mutex; others await its result. Solves the [Claude Code #24317](https://github.com/anthropics/claude-code/issues/24317) class of bugs.

### Long-running tool calls and `progressToken`

Same machinery as pause-on-reauth, but triggered by a different signal:

- If the tool call carries a `progressToken` and the MCP server emits progress notifications, the bridge passes them through to the entity timeline as they arrive.
- v1: progress events are visible to the user; the wake stays open. (Same as today's tool calls.)
- v2 (deferred): on first progress notification, optionally end the wake and treat further progress / terminal events as wake events. Durable substrate makes this cheap; deferring until a real long-running MCP server enters the picture.

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
        "tokenUrl": "https://sentry.io/oauth/token"
      }
    },
    "github": {
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
        "scopes": ["repo", "read:user"]
      }
    },
    "honeycomb": {
      "transport": "http",
      "url": "https://api.honeycomb.io/mcp/",
      "auth": { "mode": "apiKey", "headerName": "X-Honeycomb-Team", "valueRef": "vault://honeycomb/api_key" }
    },
    "git-local": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git", "--repository", "${workspaceRoot}"]
    }
  }
}
```

Code escape hatch for dynamic registration:

```ts
import { runtime } from '@electric-ax/agents-runtime'

runtime.registerMcpServer('linear', {
  transport: 'http',
  url: 'https://mcp.linear.app/v1',
  auth: { mode: 'authorizationCode', flow: 'browser', scopes: ['read', 'write'] },
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
    ...mcp.tools(['sentry', 'github']),  // explicit list
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
  // Optional: list refs for the catalog UI
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

A new page in agents-server-ui listing all registered servers as rows. Each row shows:

- **Name and transport** (stdio / http).
- **Auth mode** (apiKey / clientCredentials / authorizationCode).
- **Status** — one of:
  - `healthy` — token valid, recent successful call.
  - `expiring` — token within configurable window of expiry, refresh is expected to succeed silently.
  - `needs_auth` — no credential in vault, or refresh failed; pending reauth.
  - `error` — server returned errors recently (other than auth).
  - `disabled` — operator paused the server.
- **Last successful call / refresh** timestamp.
- **Per-row actions:** `Authorize` / `Re-authorize` / `Disconnect` / `Disable` / `Enable`.
- **Pending reauth detail** — when a tool call is paused waiting on this server, show the count of pending calls and (for device flow) the user code + verification URL.

## MCP spec conformance

We follow the MCP authorization spec for HTTP servers:

- OAuth 2.1 with PKCE (S256).
- Dynamic Client Registration (RFC 7591).
- Protected Resource Metadata (RFC 9728) for resource discovery.
- Resource Indicators (RFC 8707).
- Streamable HTTP transport per the current spec.

Two intentional deviations:

1. **Pause-tool-call-on-auth-fail** instead of returning a 401 to the model. The spec doesn't forbid this; it's a runtime-level concern about how to handle auth failures.
2. **Durable progress-token handling.** Pass-through to the timeline in v1; durable suspend-on-progress in a future version.

We add device-code grant (RFC 8628) as a first-class flow alongside browser-redirect — better fit for headless / webhook-spawned / remote-runtime contexts where there's no developer-at-a-browser.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stdio subprocess crashes leak tool-call state | Bridge marks in-flight calls as failed on subprocess exit; restart on next call |
| Refresh-token race across wakes | Per-`(server, scope)` mutex around the refresh exchange; runtime owns the credential, not the wake |
| Vault file leaks if file permissions wrong | Default implementation enforces `chmod 600`; encryption-at-rest where keychain available |
| Operator misconfigures `authorizationCode` for unattended workflow | Schema validator warns; docs call out the right modes for unattended use |
| Hot-reload causes user confusion when tool list changes mid-wake | Manifest snapshot at compose time; tool catalog visible in agents-server-ui shows the truth at any moment |
| Stdio + personal credentials confused for a deployment pattern | Documentation prominently scopes it as local-dev only |

## Rollout plan

1. **Phase 1 — registry and bridge.** MCP Registry (with `mcp.json` loading and file-watch), key vault interface + file-on-disk default, stdio + HTTP bridge, per-agent allowlist, hot-reload of newly-added servers. No OAuth yet — only `apiKey` mode. Goal: agents can call MCP tools given a pre-configured API key, and operators can hot-add new API-key servers.
2. **Phase 2 — OAuth.** OAuth Coordinator with PKCE/DCR, browser-redirect flow, silent refresh with per-`(server, scope)` mutex. `clientCredentials` and `authorizationCode (browser)`.
3. **Phase 3 — pause-on-reauth.** Durable pending-tool-call state, server-state wake events, retry-on-resume, coalescing, TTL.
4. **Phase 4 — UI.** Connected Services page, inline timeline reauth prompts, progress passthrough.
5. **Phase 5 — device-code flow.** Add `authorizationCode (device)` for headless contexts; surface user code + verification URL on the catalog.
6. **Phase 6 — polish.** Dynamic `runtime.registerMcpServer` API, in-flight-safe reconfiguration of running servers, schema validator warnings.

Phases 1–4 are the meaningful product. 5–6 add the unattended-workflow polish.

## Open questions

- **Stdio process resource limits.** Default off in v1; revisit if operators report runaway-process incidents.
- **Multi-server reauth ordering.** When two servers both need auth in one wake, do we surface them as one combined prompt or two separate prompts? Default: separate; revisit if the UX is bad.
- **Vault rotation.** Mechanics of rotating an `apiKey` while in-flight calls are using it — need to confirm a clean swap.
- **Schema validator severity.** Should `authorizationCode` mode for an unattended-flagged workflow be a warning or a hard error? Probably warning until we have user feedback.
- **Catalog page for `mcp.tools('*')` agents.** When `'*'` agents exist, do we show the resolved set as of last compose, or always the live set? Probably last compose, with a note.
- **Server-side rate limiting / circuit breakers.** Out of scope for v1; revisit if MCP servers cause cascading failures in agent workflows.

## Appendix: prior-art summary

(Distilled from a research scan of Claude Code, Cursor, Cline, Continue.dev, Windsurf, Zed, Codex CLI, Aider, VS Code, and Goose, conducted while drafting this design.)

- **No coding agent has a real Connected Services catalog.** Several open issues in Claude Code trace directly to its absence ([#30272](https://github.com/anthropics/claude-code/issues/30272), [#18442](https://github.com/anthropics/claude-code/issues/18442)).
- **Refresh-token races bite multi-session agents.** [Claude Code #24317](https://github.com/anthropics/claude-code/issues/24317).
- **Suspend-on-progress-token is unimplemented anywhere** despite the MCP spec supporting `progressToken` and Streamable HTTP resumption.
- **Goose's keychain-first credential storage** with env-var override and file fallback is the cleanest pattern in the field.
- **Claude Code's `.mcp.json` + `~/.claude.json` split** (committed team manifest + personal credential overlay) is the strongest onboarding pattern.
- **Device-code flow** (Goose) is friendlier than browser-redirect for headless contexts.
