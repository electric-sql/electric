# Agents Desktop Configuration Plan

## Goal

Move the Agents desktop app from a single global active server and mixed storage model to a clearer configuration architecture that supports:

- Multiple configured remote agents servers.
- Independent connect/disconnect/reconnect lifecycle per server.
- Per-window server selection.
- A local `BuiltinAgentsServer` instance per connected remote server.
- Secure storage for API keys, auth tokens, and future per-server credentials.
- A browser-compatible version of the shared UI with reduced functionality.
- Future Electric Cloud account sign-in and hosted server discovery.

`BuiltinAgentsServer` is expected to remain single-server scoped. Multi-server desktop support should therefore be built by managing multiple `BuiltinAgentsServer` instances in Electron main, not by making one runtime multiplex several upstream servers.

## Current State

The shared UI in `packages/agents-server-ui` stores most UI preferences in `localStorage`:

- Theme preference.
- Server list in web mode.
- Workspace layouts keyed by active server URL.
- Sidebar state, pins, expanded tree nodes, recent directories, model choice, and timeline row-height caches.

The Electron app in `packages/agents-desktop` persists heavier desktop state in `app.getPath("userData")/settings.json`:

- Saved servers.
- A single global active server.
- Working directory.
- Provider API keys.
- Global MCP server config.

Desktop currently exposes this state to the renderer through `window.electronAPI`. The main architectural limitation is that there is one global `settings.activeServer` and one global `runtime`. Switching the active server restarts the single runtime and affects every window.

MCP OAuth credentials already have a platform credential-store path in `packages/agents-mcp`, using macOS Keychain and Linux Secret Service. Windows support is not implemented there yet. Provider API keys are currently plaintext in `settings.json`.

## Target Model

Separate the app into three concepts:

1. Server profiles: durable configuration describing a known server.
2. Server connections: app-wide runtime lifecycle for a server profile.
3. Window selection: per-window pointer to the server the UI is currently showing.

Selection is per-window. Connection lifecycle is per-server and app-wide.

That gives us the desired behavior:

- Users can configure many servers.
- Each server can be manually connected or disconnected.
- Connected servers keep trying to reconnect when unreachable.
- Connected servers reconnect automatically on app restart.
- Disconnected servers remain in the list but do not auto-retry.
- Windows can point at different servers.
- The sidebar switcher changes the current window's selected server.
- The connect/disconnect control in the switcher changes the server connection lifecycle.
- Local scanned servers are shown as suggestions and are not persisted until the user connects or saves them.
- Future Electric Cloud servers can be listed as account-backed suggestions before they are explicitly connected.

## Data Model

Introduce stable IDs for server profiles. Do not use URL as the long-term identity, because URLs can change and future Cloud servers may have provider IDs.

```ts
type ServerProfile = {
  id: string
  name: string
  url: string
  source: 'manual' | 'local-discovery' | 'electric-cloud'
  desiredState: 'connected' | 'disconnected'
  auth?: ServerAuthConfig
  localOverrides?: ServerLocalOverrides
  createdAt: number
  updatedAt: number
}

type ServerAuthConfig =
  | { kind: 'none' }
  | { kind: 'bearer'; tokenRef: string }
  | { kind: 'cloud'; accountId: string; serverId: string }

type ServerLocalOverrides = {
  apiKeysRef?: string
  mcpConfigRef?: string
  workingDirectory?: string
}
```

Runtime state should be maintained in Electron main and broadcast to renderer windows:

```ts
type ServerConnectionState = {
  serverId: string
  status:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'offline'
    | 'error'
  runtimeUrl: string | null
  lastError: string | null
  reconnectAttempt: number
  lastConnectedAt: number | null
}
```

Window state should be tracked independently:

```ts
type DesktopWindowState = {
  windowId: string
  selectedServerId: string | null
}
```

Workspace layout persistence should migrate from URL-keyed storage to server-ID-keyed storage:

```txt
electric-agents-ui.workspace.<serverId>.v3
```

Keep a one-time migration path from the current v2 URL-keyed layout key.

## Storage Architecture

### Non-Secret Config

Continue using a JSON file under Electron `userData`, but narrow it to non-secret config:

```ts
type DesktopSettings = {
  version: 2
  servers: Array<ServerProfile>
  defaultServerId: string | null
  globalLocalConfig: {
    workingDirectory: string | null
    apiKeysRef?: string
    mcpConfig?: unknown
  }
}
```

This file can safely contain names, URLs, desired connection state, and references to secrets. It must not contain raw API keys, bearer tokens, OAuth refresh tokens, or client secrets.

### Secrets

Move desktop secrets to a `SecretStore` abstraction backed by Electron `safeStorage`.

Initial shape:

```ts
interface SecretStore {
  get(ref: string): Promise<string | null>
  set(ref: string, value: string): Promise<void>
  delete(ref: string): Promise<void>
}
```

Recommended implementation:

- Store encrypted secret blobs in a JSON file under `userData`.
- Encrypt/decrypt using Electron `safeStorage`.
- Generate opaque refs such as `secret_api_keys_global`, `secret_api_keys_server_<serverId>`, `secret_server_token_<serverId>`.
- Keep all secret access in Electron main.
- Never expose raw secrets in `settings.json`.

This fits the desktop app well and gives a good Windows story through Electron's platform-backed encryption. The existing MCP keychain path can remain initially, but should eventually be wrapped by the same `SecretStore` mental model so provider API keys, Cloud auth tokens, and MCP credentials are handled consistently.

For web, the shared UI should not store provider secrets. Web mode should continue to assume credentials are owned by the connected server or by future Cloud auth.

## Runtime Manager

Add a `RuntimeManager` in Electron main.

Responsibilities:

- Own `Map<serverId, RuntimeEntry>`.
- Start one `BuiltinAgentsServer` per connected server.
- Stop runtimes when the user disconnects a server.
- Retry connected servers with backoff when the remote server is unreachable.
- Restore connected servers on app start based on persisted `desiredState`.
- Broadcast per-server connection state to renderer windows.
- Forward per-server MCP registry snapshots and actions.

Sketch:

```ts
type RuntimeEntry = {
  profile: ServerProfile
  desiredState: 'connected' | 'disconnected'
  status: ServerConnectionState['status']
  runtime: BuiltinAgentsServer | null
  runtimeUrl: string | null
  reconnectTimer: NodeJS.Timeout | null
  reconnectAttempt: number
  lastError: string | null
}
```

Reconnect behavior:

- `desiredState: 'connected'` means keep trying until connected.
- `desiredState: 'disconnected'` means stop runtime and cancel retries.
- Health-check before starting the local runtime.
- Use exponential backoff with jitter, capped to a reasonable maximum.
- Reset backoff after a successful connection.
- Keep the server visible in the UI even when offline.

## Renderer API

Replace the current global active-server IPC surface with server-aware and window-aware APIs.

Suggested preload surface:

```ts
window.electronAPI.servers.list()
window.electronAPI.servers.save(profile)
window.electronAPI.servers.remove(serverId)
window.electronAPI.servers.connect(serverId)
window.electronAPI.servers.disconnect(serverId)
window.electronAPI.servers.onState(callback)

window.electronAPI.windows.getSelectedServer()
window.electronAPI.windows.setSelectedServer(serverId)
window.electronAPI.windows.onSelectedServerChanged(callback)

window.electronAPI.mcp.getSnapshot(serverId)
window.electronAPI.mcp.onState(serverId, callback)
window.electronAPI.mcp.authorize(serverId, name)
window.electronAPI.mcp.reconnect(serverId, name)
window.electronAPI.mcp.disable(serverId, name)
window.electronAPI.mcp.enable(serverId, name)
```

The shared UI should continue to work without Electron:

- Web uses browser-backed server profiles.
- Web has no local runtime controls.
- Web has no desktop secret store.
- Web defaults to `window.location.origin` when no server is configured.

## Settings Organization

Settings should be organized around the user's mental model, with `Servers` as the primary management surface.

Recommended settings sidebar:

- General
- Servers
- Credentials
- MCP
- Appearance
- Account, once Electric Cloud sign-in exists

Do not add a separate "Local Runtimes" settings page. A local runtime is an implementation detail of a connected server: every connected server has exactly one local `BuiltinAgentsServer`, and every local `BuiltinAgentsServer` belongs to exactly one server profile. Splitting runtimes into a separate top-level page would duplicate the server list and make it less clear where connect/disconnect should happen.

### General

Keep app-level preferences here:

- Startup behavior.
- Whether to restore connected servers on launch.
- Whether to keep connected runtimes alive when all windows are closed.
- Default new-window behavior.

### Servers

This should be the main configuration and operational page.

The server list should show:

- Name, URL, and source.
- Selected-in-this-window indicator.
- Connection status.
- Connect, disconnect, or retry action.

The server detail view should include:

- Connection: URL, desired state, health, last error, reconnect status.
- Local runtime: runtime URL, restart, stop/disconnect, logs shortcut later.
- Credentials: use global defaults or configure per-server overrides.
- MCP: resolved MCP status for this server and future per-server overrides.
- Working directory: global default or server-specific override.
- Danger zone: remove server and optionally delete associated secrets.

The sidebar switcher remains the quick control. `Settings > Servers` is the full management surface.

### Credentials

Store global provider API keys here. These are app-wide defaults used by connected local runtimes unless a server has overrides.

The UI should show whether each key is configured, but should not display raw values by default. Raw values should only move across IPC during explicit edit/save flows.

### MCP

Keep MCP as a top-level settings section for global MCP defaults and visibility into the resolved registry state.

The page should make layering explicit:

```txt
workspace mcp.json > server override > global desktop MCP
```

Per-server MCP controls should also be reachable from `Settings > Servers > <server>`, because users will often arrive there while debugging one server.

### Appearance

Keep appearance separate while it has its own clear page. It can be folded into `General` later if the settings sidebar becomes too broad.

### Account

Future Electric Cloud sign-in belongs in `Account`. Cloud-discovered servers can then appear in `Servers` as account-backed suggestions.

## First-Start Onboarding

Keep the current first-start API key prompt, but treat it as a lightweight onboarding step rather than a bare credentials modal.

Goals:

- Help the user get to a working local runtime quickly.
- Explain why the app needs provider keys.
- Store keys through `SecretStore`, not `settings.json`.
- Avoid blocking users who only want to connect to an already-configured remote or future Cloud-hosted server.

Recommended flow:

1. Detect whether global provider keys are configured.
2. If no provider key exists, open an onboarding dialog on first desktop launch.
3. Explain that Anthropic or OpenAI is needed for the local bundled runtime.
4. Pre-fill suggestions from launch environment variables when available.
5. Save entered keys to the secure secret store.
6. Offer a "Skip for now" path that leaves the app usable for remote-only workflows.
7. After saving, connect or reconnect any servers whose local runtime depends on those keys.

The onboarding dialog should link to `Settings > Credentials` for later editing. Once Electric Cloud sign-in exists, the onboarding should likely become a short choice:

- Sign in to Electric Cloud.
- Use local runtime with provider API keys.
- Connect to an existing agents server.
- Skip for now.

## Sidebar Switcher UX

The bottom sidebar switcher should represent both selection and lifecycle.

Proposed behavior:

- Clicking the main row area switches the current window to that server.
- A right-side status/control connects or disconnects the server.
- Connected and reconnecting servers remain selectable.
- Offline servers remain selectable and show an offline state inside the workspace instead of triggering noisy stream errors.
- Disconnected servers are selectable only if we have a usable remote URL, but their workspace should show a disconnected prompt until connected.
- Local discovered servers appear in a separate section and are not persisted until the user connects/saves them.
- Future Electric Cloud servers appear in a separate account-backed section.

Status labels:

- Connected
- Connecting
- Reconnecting
- Offline
- Error
- Disconnected
- Discovered

## Error Handling

Introduce a first-class connection state per server instead of relying on ad hoc fetch failures.

The UI should avoid creating Electric collections or entity stream connections when the selected server is not connected. Render clear offline/disconnected states instead.

Changes needed:

- Gate `ElectricAgentsProvider` on server connection status, not just `activeServer.url`.
- Replace route-bouncing on entity stream errors with inline tile errors and retry controls.
- Keep workspace layouts intact when servers go offline.
- Only prune/close entity tiles when the server is connected and the entity is proven deleted.
- Surface runtime errors in the server detail page and server switcher.
- Add manual retry from the server switcher and `Settings > Servers`.

## Local Discovery

Keep the existing localhost scan, but model discovered servers separately from persisted profiles.

Rules:

- Discovery results are ephemeral.
- Discovery entries should not be written to settings until the user connects/saves them.
- If a discovered URL matches a configured server, merge the discovery health signal into that server's display.
- When the user connects to a discovered server, create a `ServerProfile` with `source: 'manual'` or `source: 'local-discovery'` and `desiredState: 'connected'`.

## Electric Cloud Future

Future Cloud support should fit the same architecture.

Add an account layer:

```ts
type CloudAccount = {
  id: string
  email: string
  tokenRef: string
}
```

Cloud-discovered servers can be listed without becoming local profiles. Once the user connects or pins one, create or update a `ServerProfile` with:

```ts
{
  source: 'electric-cloud',
  auth: { kind: 'cloud', accountId, serverId }
}
```

Cloud access tokens should live in `SecretStore`, not `settings.json`.

## Migration Plan

1. Add `SecretStore` backed by Electron `safeStorage`.
2. Migrate provider API keys from `settings.json.apiKeys` into the secret store.
3. Add server IDs to saved servers and migrate the existing `activeServer` to `defaultServerId`.
4. Replace global desktop active server with per-window selected server.
5. Add `RuntimeManager` with one `BuiltinAgentsServer` per connected server.
6. Persist `desiredState` per server and reconnect connected servers on startup.
7. Update preload IPC to server-aware/window-aware APIs.
8. Update first-start API key modal into a lightweight onboarding flow backed by `SecretStore`.
9. Update `agents-server-ui` provider state to use selected server plus connection state.
10. Update workspace persistence to key by server ID, with migration from URL-keyed v2 storage.
11. Update Server Picker UI to include connect/disconnect controls and discovered sections.
12. Add `Settings > Servers` with server detail panes that include local runtime status and controls.
13. Move MCP IPC to be server-scoped.
14. Add Cloud account/server discovery on top of the same profile and secret-store model when ready.

## Product Decisions

- Per-server API keys inherit from global provider keys by default. Users can configure per-server overrides when needed.
- MCP configuration is global by default, with optional per-server overrides. Workspace `mcp.json` still has the highest precedence when present.
- A disconnected selected server should show its last workspace layout, with connection/disconnected state surfaced in the workspace.
- Closing the last window should keep connected servers and their local runtimes alive in the tray. This is important for long-running remote control workflows.
- Any destructive action, including removing a server or deleting associated secrets, requires confirmation.
- Local discovered servers can be auto-named by port only.

## Testing Notes

Prioritize tests around:

- Settings migration from current `settings.json`.
- API key migration into encrypted secret storage.
- Runtime manager reconnect behavior.
- Per-window selected server isolation.
- Workspace layout migration from URL key to server ID key.
- Server picker behavior for configured, disconnected, offline, and discovered servers.
- No raw secrets written to `settings.json`.
