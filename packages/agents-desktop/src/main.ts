import type {
  BuiltinAgentsServer,
  McpServerConfig,
  RegistrySnapshot,
} from '@electric-ax/agents'
import { openAuthorizeWindow } from './oauth-window'
import { SecretStore } from './secret-store'
import {
  CloudAuth,
  type CloudAuthProvider,
  type CloudAuthState,
} from './cloud-auth'
import {
  CloudAgentServers,
  type CloudAgentServersState,
} from './cloud-agent-servers'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
} from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as undici from 'undici'
import type { Dispatcher } from 'undici'

type ServerSource = `manual` | `local-discovery` | `electric-cloud`
type ServerDesiredState = `connected` | `disconnected`

type ServerConfig = {
  id: string
  name: string
  url: string
  source: ServerSource
  desiredState: ServerDesiredState
  localRuntimeEnabled: boolean
  headers?: Record<string, string>
  /**
   * For `source: 'electric-cloud'` only — the `stream_services.id`
   * the cloud-agents-server uses to identify this tenant. The
   * matching agents bearer token lives in `SecretStore` keyed by tenant id
   * (`cloud-agents-token:<tenantId>`), not in `settings.json`.
   * The webRequest hook reads both fields to inject auth headers
   * on outgoing requests targeting this server's URL.
   */
  tenantId?: string
}

type ServerConnectionStatus =
  | `disconnected`
  | `connecting`
  | `connected`
  | `reconnecting`
  | `offline`
  | `error`

type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`
type LocalRuntimeStatus =
  | `disabled`
  | `stopped`
  | `starting`
  | `running`
  | `error`

type DiscoveredServer = {
  url: string
  port: number
  /** Epoch ms — when we last saw a healthy `/_electric/health` response. */
  lastSeen: number
}

type DesktopState = {
  servers: Array<ServerConfig>
  selectedServerId: string | null
  connections: Array<ServerConnectionState>
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  /**
   * Agents-server instances detected on this machine via the periodic
   * localhost scan in `runDiscovery()`. Renderers (e.g. `ServerPicker`)
   * surface these as one-click "add" suggestions.
   */
  discoveredServers: Array<DiscoveredServer>
  pullWakeRunnerId: string | null
}

type ServerConnectionState = {
  serverId: string
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtimeUrl: string | null
  runtimeError: string | null
  lastError: string | null
  reconnectAttempt: number
  lastConnectedAt: number | null
}

type ApiKeys = {
  anthropic: string | null
  openai: string | null
  /**
   * Optional. Mirrored to `BRAVE_SEARCH_API_KEY` so Horton's
   * `brave_search` tool can call the Brave API directly. When unset
   * Horton falls back to Anthropic's built-in web search (which uses
   * the Anthropic key). Because it's optional, missing brave never
   * triggers the first-launch dialog on its own.
   */
  brave: string | null
}

type DesktopSettings = {
  servers: Array<ServerConfig>
  defaultServerId: string | null
  workingDirectory: string | null
  apiKeysRef: string
  /**
   * Onboarding wizard ("Sign in to Electric Cloud" → API keys) gets
   * surfaced on launch until the user finishes it or explicitly
   * clicks "Don't show again". Once set, the modal stays hidden even
   * if the user later signs out / clears keys. Settings → General and
   * Settings → Account are the recovery paths after that.
   */
  onboardingDismissed?: boolean
  /**
   * MCP servers shipped by the desktop app's settings — global to all
   * workspaces, edited via the Settings UI (or by hand in
   * `settings.json` for now). On disk this mirrors `mcp.json`'s
   * keyed-by-name shape (`{ servers: { foo: { ... } } }`); the array
   * here is the in-memory rewrite that `BuiltinAgentsServer.
   * extraMcpServers` consumes. `loadSettings` and `saveSettings`
   * handle the conversion in both directions. Layered with the
   * per-workspace `mcp.json` at runtime: non-conflicting servers from
   * both files load together; on name collision, the workspace
   * `mcp.json` wins. Static shape only — secrets and persistence
   * callbacks are wired by the runtime (keychain auto-applied to
   * `authorizationCode` servers).
   */
  mcp?: { servers: Array<McpServerConfig> }
  pullWakeRunnerId?: string
}

type RuntimeEntry = {
  serverId: string
  desiredState: ServerDesiredState
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtime: BuiltinAgentsServer | null
  runtimeUrl: string | null
  runtimeError: string | null
  reconnectTimer: NodeJS.Timeout | null
  reconnectAttempt: number
  generation: number
  lastError: string | null
  lastConnectedAt: number | null
  mcpUnsubscribe: (() => void) | null
}

/**
 * Payload returned by `desktop:get-api-keys-status`. The renderer
 * uses `saved` to seed the first-launch dialog (or skip showing it
 * when keys already exist) and `suggested` to pre-fill empty fields
 * with whatever was found in `process.env` at startup — making it a
 * one-click confirmation flow for users who already export their
 * keys from a shell rc file.
 */
type ApiKeysStatus = {
  hasAnyKey: boolean
  saved: ApiKeys
  suggested: ApiKeys
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(MODULE_DIR, `..`)
const RESOURCE_DIR = app.isPackaged ? process.resourcesPath : PACKAGE_DIR
const RENDERER_INDEX = app.isPackaged
  ? path.join(RESOURCE_DIR, `renderer`, `index.html`)
  : path.resolve(PACKAGE_DIR, `../agents-server-ui/dist-desktop/index.html`)
// Bundled `@electric-ax/agents` can't resolve its own skills dir; supply it explicitly.
const AGENT_SKILLS_DIR = app.isPackaged
  ? path.join(RESOURCE_DIR, `agent-skills`)
  : path.resolve(PACKAGE_DIR, `../agents/skills`)
const PRELOAD_PATH = path.resolve(MODULE_DIR, `preload.cjs`)
const TRAY_ICON_PATH = path.join(RESOURCE_DIR, `assets`, `trayTemplate.png`)
const TRAY_ICON_2X_PATH = path.join(
  RESOURCE_DIR,
  `assets`,
  `trayTemplate@2x.png`
)
const APP_ICON_FILE =
  process.platform === `darwin` ? `icon-mac.png` : `icon.png`
const APP_ICON_PATH = path.join(RESOURCE_DIR, `assets`, APP_ICON_FILE)
const APP_DISPLAY_NAME = `Electric Agents`
const MAX_CONNECTIONS_PER_HOST = `256`
const SETTINGS_VERSION = 2
const GLOBAL_API_KEYS_REF = `api-keys:global`
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const DESKTOP_USER_DATA_DIR =
  process.env.ELECTRIC_DESKTOP_USER_DATA_DIR?.trim() || null
const INITIAL_SERVER_URL =
  process.env.ELECTRIC_DESKTOP_SERVER_URL?.trim() ||
  process.env.ELECTRIC_AGENTS_SERVER_URL?.trim() ||
  null

if (DESKTOP_USER_DATA_DIR) {
  app.setPath(`userData`, path.resolve(DESKTOP_USER_DATA_DIR))
}

// Stable OAuth redirect base for MCP DCR (RFC 7591). The runtime
// listens on an ephemeral port but the redirect URI must be constant
// across restarts so the cached DCR client info stays valid. Loopback
// literal form per RFC 8252 §7.3; nothing listens at this port — our
// BrowserWindow intercepts the redirect by prefix before anything
// reaches the network.
const MCP_OAUTH_REDIRECT_BASE = `http://127.0.0.1:53117`

// Electric streams can hold many long-polling HTTP requests open to the same
// agents server. Raise Chromium's default per-host connection cap before
// Electron creates its network context so those streams do not queue behind it.
app.commandLine.appendSwitch(
  `max-connections-per-host`,
  MAX_CONNECTIONS_PER_HOST
)

/**
 * When set, the renderer is loaded from this dev-server URL instead
 * of the prebuilt `dist-desktop/index.html` file. Wired up by the
 * `dev` script in `package.json`, which boots Vite on port 5174 and
 * exports `ELECTRIC_DESKTOP_DEV_SERVER_URL=http://localhost:5174`
 * so the renderer gets full HMR. Unset in `start` / packaged builds,
 * so production keeps loading the static bundle from disk.
 */
const DEV_SERVER_URL = process.env.ELECTRIC_DESKTOP_DEV_SERVER_URL ?? null
const PULL_WAKE_RUNNER_ID =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID?.trim() || null
const PULL_WAKE_REGISTER_RUNNER =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER === undefined
    ? true
    : [`1`, `true`].includes(
        process.env.ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER.trim().toLowerCase()
      )
const PULL_WAKE_OWNER_USER_ID =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_OWNER_USER_ID?.trim() ||
  `local-desktop`
const DEV_PRINCIPAL = ((): string | null => {
  const raw = process.env.ELECTRIC_DESKTOP_PRINCIPAL?.trim() || null
  if (!raw) return null
  const colon = raw.indexOf(`:`)
  if (colon <= 0) {
    console.error(
      `[agents-desktop] ELECTRIC_DESKTOP_PRINCIPAL="${raw}" is invalid. ` +
        `Expected format: "kind:id" (e.g. "system:dev-local"). Ignoring.`
    )
    return null
  }
  console.info(`[agents-desktop] Using dev principal: ${raw}`)
  return raw
})()
const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`

function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const headers = new Headers()
  for (const source of sources) {
    if (!source) continue
    new Headers(source).forEach((value, key) => headers.set(key, value))
  }
  const merged = headersToRecord(headers)
  return Object.keys(merged).length > 0 ? merged : undefined
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string
): boolean {
  return headers ? new Headers(headers).has(name) : false
}

function runnerOwnerUserIdFromHeaders(
  headers: Record<string, string> | undefined
): string {
  const normalized = new Headers(headers)
  return (
    normalized.get(`authorization`)?.trim() ||
    normalized.get(ELECTRIC_PRINCIPAL_HEADER)?.trim() ||
    PULL_WAKE_OWNER_USER_ID
  )
}

/**
 * Commands sent from the menu / tray (main process) to the focused
 * renderer over the `desktop:command` IPC channel. The renderer
 * subscribes via `window.electronAPI.onDesktopCommand` and dispatches
 * to the matching app action (sidebar toggle, search palette, new
 * chat, close active tile…). Keeping the menu definitions in main and
 * the action implementations in the renderer means the same actions
 * stay reachable from in-app buttons / hotkeys when running in a
 * regular browser.
 */
type DesktopCommand =
  | `new-chat`
  | `close-tile`
  | `toggle-sidebar`
  | `open-settings`
  | `open-servers-settings`
  | `open-search`
  | `open-find`
  | `find-next`
  | `find-previous`
  | `split-right`
  | `split-down`
  | `cycle-tile`

type DesktopMenuSection = `File` | `Edit` | `View` | `Window` | `Help`

type DesktopMenuPopupBounds = {
  x: number
  y: number
  width: number
  height: number
}

type DesktopMenuState = {
  hasActiveTile: boolean
  canCloseTile: boolean
  canSplitTile: boolean
  canCycleTile: boolean
}

type DesktopNavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

type DesktopAppearance = `light` | `dark` | `system`

type DesktopContextMenuRequest = {
  kind: `selection`
  selectionText: string
}

const EXTERNAL_LINK_PROTOCOLS = new Set([`http:`, `https:`, `mailto:`])

const DEFAULT_SETTINGS: DesktopSettings = {
  servers: [],
  defaultServerId: null,
  workingDirectory: null,
  apiKeysRef: GLOBAL_API_KEYS_REF,
}

/**
 * Snapshot of provider API keys as they were when the app launched.
 * Captured before `applyApiKeys()` overwrites the live env so
 * `desktop:get-api-keys-status` can offer them as one-click
 * suggestions when the user hasn't saved any keys yet.
 *
 * Recapturing on every status query would defeat the purpose: by
 * then `applyApiKeys()` has already mirrored the saved values into
 * `process.env`, which would loop back as a "suggestion" identical
 * to the saved value.
 */
const ENV_API_KEYS_SNAPSHOT: ApiKeys = {
  anthropic: process.env.ANTHROPIC_API_KEY?.trim() || null,
  openai: process.env.OPENAI_API_KEY?.trim() || null,
  brave: process.env.BRAVE_SEARCH_API_KEY?.trim() || null,
}

let settings: DesktopSettings = { ...DEFAULT_SETTINGS }
let apiKeys: ApiKeys = { anthropic: null, openai: null, brave: null }
let state: DesktopState = {
  servers: [],
  selectedServerId: null,
  connections: [],
  runtimeStatus: `stopped`,
  runtimeUrl: null,
  activeServer: null,
  workingDirectory: null,
  error: null,
  discoveredServers: [],
  pullWakeRunnerId: null,
}
let tray: Tray | null = null
let aboutWindow: BrowserWindow | null = null
let isQuitting = false
const windows = new Set<BrowserWindow>()
const windowSelections = new Map<number, string | null>()
const runtimeEntries = new Map<string, RuntimeEntry>()
const lastMcpSnapshots = new Map<string, RegistrySnapshot>()
let secretStore: SecretStore | null = null
let cloudAuth: CloudAuth | null = null
let cloudAgentServers: CloudAgentServers | null = null

function configureRuntimeEnvironment(): void {
  // Packaged macOS apps can launch with cwd `/`, which makes the agents
  // logger's default `./logs` path resolve to unwritable `/logs`.
  process.env.ELECTRIC_AGENTS_LOG_DIR ??= path.join(
    app.getPath(`userData`),
    `logs`
  )
}
configureRuntimeEnvironment()

function settingsPath(): string {
  return path.join(app.getPath(`userData`), `settings.json`)
}

function secretsPath(): string {
  return path.join(app.getPath(`userData`), `secrets.json`)
}

function getSecretStore(): SecretStore {
  if (!secretStore) secretStore = new SecretStore(secretsPath())
  return secretStore
}

function getCloudAuth(): CloudAuth {
  if (!cloudAuth) {
    cloudAuth = new CloudAuth(getSecretStore())
    cloudAuth.subscribe((next) => {
      broadcastCloudAuthState(next)
      // Drive cloud-agent-servers from auth state transitions: start the
      // shape streams when we have a token, tear them down on sign-out.
      if (next.status === `signed-in`) {
        void getCloudAgentServers().start()
      } else {
        void getCloudAgentServers().stop()
      }
    })
  }
  return cloudAuth
}

function getCloudAgentServers(): CloudAgentServers {
  if (!cloudAgentServers) {
    cloudAgentServers = new CloudAgentServers(getCloudAuth(), getSecretStore())
    cloudAgentServers.subscribe((next) => broadcastCloudAgentServersState(next))
  }
  return cloudAgentServers
}

function broadcastCloudAuthState(next: CloudAuthState): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:cloud-auth-state-changed`, next)
    }
  }
}

function broadcastCloudAgentServersState(next: CloudAgentServersState): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:cloud-agent-servers-state-changed`, next)
    }
  }
}

/**
 * Match a request URL against the user's saved `electric-cloud`
 * servers by host + path prefix. Cloud URLs are tenant-scoped as
 * `/services/<tenantId>`, so a single cloud-agents-server host can
 * serve multiple tenants without us attaching tenant A's token to
 * tenant B's request.
 *
 * Legacy settings may still have a host-only Cloud URL from older
 * builds. We allow that only when it is the sole possible match for
 * the origin; otherwise we fail closed until `prepareConnection`
 * rewrites the saved URL to the tenant-scoped form.
 */
function findCloudServerForUrl(requestUrl: string): ServerConfig | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }
  const hostOnlyMatches: Array<ServerConfig> = []
  for (const server of settings.servers) {
    if (server.source !== `electric-cloud`) continue
    if (!server.tenantId) continue
    let base: URL
    try {
      base = new URL(server.url)
    } catch {
      continue
    }
    if (base.origin !== parsed.origin) continue
    const basePath = base.pathname.replace(/\/+$/, ``)
    if (basePath === ``) {
      hostOnlyMatches.push(server)
      continue
    }
    if (
      parsed.pathname === basePath ||
      parsed.pathname.startsWith(`${basePath}/`)
    ) {
      return server
    }
  }
  return hostOnlyMatches.length === 1 ? hostOnlyMatches[0]! : null
}

/**
 * Decorate outgoing requests bound for a saved cloud agent server
 * with `Authorization: Bearer <agents token>` and
 * `x-electric-service: <tenantId>` headers. Two injection points,
 * both reading from the same in-memory agents-token map
 * (`SecretStore`-backed):
 *
 *  1. Renderer fetches — Electron's
 *     `session.webRequest.onBeforeSendHeaders` hook catches anything
 *     coming out of `webContents.fetch` / shape streams / etc.
 *  2. Main-process fetches — installed as a global undici dispatcher
 *     interceptor so `BuiltinAgentsServer`'s outbound calls (entity-
 *     type registration, runtime → agents-server traffic) and our
 *     own `checkAgentsServerHealth` all pick up the same auth
 *     without each call-site needing to know.
 *
 * The agents bearer token lives only in the encrypted `SecretStore` + the
 * in-memory agents-token map — neither the renderer nor
 * `settings.json` ever sees it.
 *
 * Installed once at app launch. Requests not matching a saved cloud
 * server pass through unchanged.
 */
function installCloudAuthHeaderInjection(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const extra = buildCloudAuthHeaders(details.url)
    if (!extra) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    callback({
      requestHeaders: { ...details.requestHeaders, ...extra },
    })
  })

  installCloudAuthUndiciInterceptor()
}

/**
 * Build the cloud-auth headers to inject on a request to `url`, or
 * `null` if the URL doesn't target a saved cloud agent server (or we
 * don't have a stored agents token for it).
 *
 * Headers emitted (only when we have the data):
 *  - `Authorization: Bearer <agents token>` — proves the request is
 *    authorized for the tenant.
 *  - `x-electric-service: <tenantId>` — routes to the right tenant.
 *  - `x-electric-asserted-user-id` / `-email` / `-name` — the cloud
 *    agents server requires these for runner-targeted dispatch (see
 *    `assertDispatchPolicyAllowed`). We assert the currently signed-in
 *    Electric Cloud user. The cloud-agents-server only trusts these
 *    when `trustAssertedUserHeaders` is enabled in its config, so
 *    they're harmless to include unconditionally.
 */
function buildCloudAuthHeaders(url: string): Record<string, string> | null {
  const server = findCloudServerForUrl(url)
  if (!server || !server.tenantId) return null
  const token = cloudAgentServers?.getAgentsToken(server.tenantId)
  if (!token) {
    // Tenant is known but the user has no stored token yet (uncommon —
    // a manual edit of `settings.json` or a `SecretStore` corruption).
    // Skip rather than send a half-authenticated request.
    return null
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'x-electric-service': server.tenantId,
  }
  const cloudAuthState = cloudAuth?.getState()
  if (cloudAuthState?.userId) {
    headers[`x-electric-asserted-user-id`] = cloudAuthState.userId
  }
  if (cloudAuthState?.email) {
    headers[`x-electric-asserted-email`] = cloudAuthState.email
  }
  if (cloudAuthState?.name) {
    headers[`x-electric-asserted-name`] = cloudAuthState.name
  }
  return headers
}

/**
 * Global undici dispatcher interceptor for the main process.
 *
 * Electron's `session.webRequest` catches renderer-side fetches but
 * not Node-side ones. The local agent runtime (`BuiltinAgentsServer`
 * from `@electric-ax/agents`) makes Node fetches to the connected
 * agent-server URL when it registers entity types and proxies
 * runtime traffic. For cloud servers those calls would 401 without
 * the agents token, so we install a global undici interceptor that
 * mirrors the renderer hook above and adds the same two headers.
 *
 * Matches by full request URL via `findCloudServerForUrl` — same
 * base-URL prefix logic as the renderer hook, so a single cloud-
 * agents-server host serving many tenants can't accidentally see
 * tenant A's token on tenant B's request.
 */
function installCloudAuthUndiciInterceptor(): void {
  const base = undici.getGlobalDispatcher()
  const composed = base.compose(
    (dispatch): Dispatcher[`dispatch`] =>
      (opts, handler) => {
        const fullUrl = composeRequestUrl(opts.origin, opts.path)
        const extra = fullUrl ? buildCloudAuthHeaders(fullUrl) : null
        if (!extra) return dispatch(opts, handler)
        // undici treats `Authorization` (capitalized) and `authorization`
        // as the same header but our `mergeUndiciHeaders` keys is
        // case-sensitive — lower-case the keys we add so a previously
        // set lower-case `authorization` from the caller gets replaced.
        const lowered: Record<string, string> = {}
        for (const [key, value] of Object.entries(extra)) {
          lowered[key.toLowerCase()] = value
        }
        return dispatch(
          { ...opts, headers: mergeUndiciHeaders(opts.headers, lowered) },
          handler
        )
      }
  )
  undici.setGlobalDispatcher(composed)
}

/**
 * Best-effort reconstruction of the URL undici is about to request.
 * `origin` is the parsed `https://host:port` of the dispatch target;
 * `path` is the request path-and-query. Either can be a string or a
 * `URL` depending on caller, so we normalize both.
 */
function composeRequestUrl(
  origin: string | URL | null | undefined,
  path: string | undefined
): string | null {
  if (!origin) return null
  const originStr = typeof origin === `string` ? origin : origin.origin
  if (!originStr) return null
  return `${originStr}${path ?? ``}`
}

/**
 * Merge a set of header overrides into whatever shape undici handed
 * us. Undici accepts headers as an object map, an `IncomingHttpHeaders`-
 * style record, or a flat `[name, value, name, value, …]` array. We
 * preserve the original shape where possible — overrides win on
 * case-insensitive name conflicts.
 */
function mergeUndiciHeaders(
  existing: Dispatcher.DispatchOptions[`headers`],
  overrides: Record<string, string>
): Record<string, string> {
  const overrideKeysLower = new Set(
    Object.keys(overrides).map((key) => key.toLowerCase())
  )
  const out: Record<string, string> = {}
  const pushPair = (name: string, value: string | undefined): void => {
    if (value === undefined) return
    if (overrideKeysLower.has(name.toLowerCase())) return
    out[name] = value
  }
  if (Array.isArray(existing)) {
    for (let i = 0; i + 1 < existing.length; i += 2) {
      const name = existing[i]
      const value = existing[i + 1]
      if (typeof name === `string` && typeof value === `string`) {
        pushPair(name, value)
      }
    }
  } else if (existing && typeof existing === `object`) {
    for (const [name, value] of Object.entries(
      existing as Record<string, string | Array<string> | undefined>
    )) {
      if (typeof value === `string`) pushPair(name, value)
      else if (Array.isArray(value)) pushPair(name, value.join(`, `))
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    out[name] = value
  }
  return out
}

function normalizeServer(
  value: unknown,
  opts: {
    activeUrl?: string | null
    defaultDesiredState?: ServerDesiredState
  } = {}
): ServerConfig | null {
  if (!value || typeof value !== `object`) return null
  const maybe = value as Partial<ServerConfig>
  if (typeof maybe.name !== `string` || typeof maybe.url !== `string`) {
    return null
  }
  const name = maybe.name.trim()
  const url = maybe.url.trim()
  if (!name || !url) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  const id =
    typeof maybe.id === `string` && maybe.id.trim()
      ? maybe.id.trim()
      : randomUUID()
  const source: ServerSource =
    maybe.source === `local-discovery` || maybe.source === `electric-cloud`
      ? maybe.source
      : `manual`
  const desiredState: ServerDesiredState =
    maybe.desiredState === `connected` || maybe.desiredState === `disconnected`
      ? maybe.desiredState
      : url === opts.activeUrl
        ? `connected`
        : (opts.defaultDesiredState ?? `disconnected`)
  const localRuntimeEnabled = maybe.localRuntimeEnabled !== false
  const headers = normalizeHeaderRecord(maybe.headers)
  const tenantId =
    source === `electric-cloud` &&
    typeof maybe.tenantId === `string` &&
    maybe.tenantId.trim().length > 0
      ? maybe.tenantId.trim()
      : undefined
  return {
    id,
    name,
    url,
    source,
    desiredState,
    localRuntimeEnabled,
    ...(headers ? { headers } : {}),
    ...(tenantId ? { tenantId } : {}),
  }
}

function normalizeHeaderRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== `object` || Array.isArray(value)) return null
  const headers = new Headers()
  for (const [rawName, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (typeof rawValue !== `string`) continue
    const name = rawName.trim()
    const headerValue = rawValue.trim()
    if (!name || !headerValue) continue
    try {
      headers.set(name, headerValue)
    } catch {
      console.warn(
        `[agents-desktop] settings.json: invalid server header '${rawName}' ignored`
      )
    }
  }
  const normalized = headersToRecord(headers)
  return Object.keys(normalized).length > 0 ? normalized : null
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

function normalizeServers(
  value: unknown,
  activeUrl?: string | null
): Array<ServerConfig> {
  if (!Array.isArray(value)) return []
  const byUrl = new Map<string, ServerConfig>()
  for (const entry of value) {
    const server = normalizeServer(entry, { activeUrl })
    if (server) byUrl.set(server.url, server)
  }
  return [...byUrl.values()]
}

function serverInList(
  server: ServerConfig | null,
  servers: Array<ServerConfig>
): boolean {
  return Boolean(
    server &&
      servers.some(
        (entry) => entry.id === server.id || entry.url === server.url
      )
  )
}

function findServer(serverId: string | null | undefined): ServerConfig | null {
  if (!serverId) return null
  return settings.servers.find((server) => server.id === serverId) ?? null
}

function defaultSelectedServerId(): string | null {
  if (serverInList(findServer(settings.defaultServerId), settings.servers)) {
    return settings.defaultServerId
  }
  return settings.servers[0]?.id ?? null
}

function normalizeApiKeys(value: unknown): ApiKeys {
  if (!value || typeof value !== `object`) {
    return { anthropic: null, openai: null, brave: null }
  }
  const maybe = value as Partial<Record<keyof ApiKeys, unknown>>
  const pick = (raw: unknown): string | null => {
    if (typeof raw !== `string`) return null
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return {
    anthropic: pick(maybe.anthropic),
    openai: pick(maybe.openai),
    brave: pick(maybe.brave),
  }
}

function hasAnyApiKey(keys: ApiKeys): boolean {
  return Boolean(keys.anthropic || keys.openai || keys.brave)
}

async function loadApiKeysFromSecret(ref: string): Promise<ApiKeys> {
  const raw = await getSecretStore().get(ref)
  if (!raw) return { anthropic: null, openai: null, brave: null }
  try {
    return normalizeApiKeys(JSON.parse(raw))
  } catch {
    return { anthropic: null, openai: null, brave: null }
  }
}

async function saveApiKeysToSecret(ref: string, keys: ApiKeys): Promise<void> {
  if (hasAnyApiKey(keys)) {
    await getSecretStore().set(ref, JSON.stringify(keys))
  } else {
    await getSecretStore().delete(ref)
  }
}

// settings.json's `mcp.servers` mirrors the shape of `mcp.json`: an
// object keyed by server name, with the entry itself omitting `name`.
// We rewrite into the array form `BuiltinAgentsServer.extraMcpServers`
// expects and surface friendly warnings on shape errors instead of
// silently dropping the field. Schema-level validation (transport /
// auth.mode / forbidden refs) still happens inside the registry's
// `applyConfig`.
function normalizeMcp(
  value: unknown
): { servers: Array<McpServerConfig> } | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== `object`) {
    console.warn(
      `[agents-desktop] settings.json: 'mcp' must be an object, got ${typeof value}; ignoring`
    )
    return undefined
  }
  const maybeServers = (value as { servers?: unknown }).servers
  if (maybeServers === undefined) return undefined
  if (
    typeof maybeServers !== `object` ||
    maybeServers === null ||
    Array.isArray(maybeServers)
  ) {
    console.warn(
      `[agents-desktop] settings.json: 'mcp.servers' must be an object keyed by server name; ignoring`
    )
    return undefined
  }
  const servers: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(
    maybeServers as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== `object`) {
      console.warn(
        `[agents-desktop] settings.json: 'mcp.servers.${name}' is not an object; skipping`
      )
      continue
    }
    if (`name` in entry && (entry as { name: unknown }).name !== name) {
      console.warn(
        `[agents-desktop] settings.json: 'mcp.servers.${name}' has a conflicting 'name' field; the keyed name wins`
      )
    }
    servers.push({ ...(entry as object), name } as McpServerConfig)
  }
  return servers.length > 0 ? { servers } : undefined
}

/**
 * Mirror persisted API keys into `process.env` so the bundled
 * `BuiltinAgentsServer` (Horton) — which reads them via
 * `process.env.ANTHROPIC_API_KEY` / `OPENAI_API_KEY` directly inside
 * `createBuiltinAgentHandler` — sees them on its next start. Saved
 * values take precedence; for slots the user hasn't saved yet we fall
 * back to whatever was in the launch environment so external `.env` /
 * shell setups keep working until the user opts in via the dialog.
 */
function applyApiKeys(): void {
  const resolveSlot = (
    saved: string | null,
    env: string | null,
    name: `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `BRAVE_SEARCH_API_KEY`
  ): void => {
    const value = saved ?? env
    if (value) {
      process.env[name] = value
    } else {
      delete process.env[name]
    }
  }
  resolveSlot(
    apiKeys.anthropic,
    ENV_API_KEYS_SNAPSHOT.anthropic,
    `ANTHROPIC_API_KEY`
  )
  resolveSlot(apiKeys.openai, ENV_API_KEYS_SNAPSHOT.openai, `OPENAI_API_KEY`)
  resolveSlot(
    apiKeys.brave,
    ENV_API_KEYS_SNAPSHOT.brave,
    `BRAVE_SEARCH_API_KEY`
  )
}

function initialServerFromEnv(): ServerConfig | null {
  if (!INITIAL_SERVER_URL) return null
  try {
    const url = new URL(INITIAL_SERVER_URL)
    if (url.protocol !== `http:` && url.protocol !== `https:`) {
      console.warn(
        `[agents-desktop] Ignoring ELECTRIC_DESKTOP_SERVER_URL with unsupported protocol: ${INITIAL_SERVER_URL}`
      )
      return null
    }
    url.hash = ``
    url.search = ``
    return normalizeServer(
      {
        name: `Environment server`,
        url: url.toString().replace(/\/$/, ``),
        source: `manual`,
      },
      { defaultDesiredState: `connected` }
    )
  } catch {
    console.warn(
      `[agents-desktop] Ignoring invalid ELECTRIC_DESKTOP_SERVER_URL: ${INITIAL_SERVER_URL}`
    )
    return null
  }
}

async function applyInitialServerFromEnv(): Promise<void> {
  const server = initialServerFromEnv()
  if (!server) return

  const existing = settings.servers.find((entry) => entry.url === server.url)
  const next = existing ?? server
  if (!existing) {
    settings.servers = [...settings.servers, next]
    ensureRuntimeEntry(next)
  }
  if (!settings.defaultServerId) {
    settings.defaultServerId = next.id
  }
  state = desktopStateForWindow(null)
  await saveSettings()
}

async function loadSettings(): Promise<void> {
  let shouldSave = false
  try {
    const raw = await readFile(settingsPath(), `utf8`)
    const parsed = JSON.parse(raw) as Partial<DesktopSettings> & {
      activeServer?: unknown
      apiKeys?: unknown
      version?: unknown
    }
    const legacyActiveServer = normalizeServer(parsed.activeServer)
    const servers = normalizeServers(parsed.servers, legacyActiveServer?.url)
    const parsedPullWakeRunnerId =
      typeof parsed.pullWakeRunnerId === `string`
        ? parsed.pullWakeRunnerId.trim()
        : null
    const pullWakeRunnerId = parsedPullWakeRunnerId || randomUUID()
    if (!parsedPullWakeRunnerId) {
      shouldSave = true
    }
    const defaultServerId =
      typeof parsed.defaultServerId === `string` &&
      servers.some((server) => server.id === parsed.defaultServerId)
        ? parsed.defaultServerId
        : (servers.find((server) => server.url === legacyActiveServer?.url)
            ?.id ??
          servers.find((server) => server.desiredState === `connected`)?.id ??
          servers[0]?.id ??
          null)
    const apiKeysRef =
      typeof parsed.apiKeysRef === `string` && parsed.apiKeysRef.trim()
        ? parsed.apiKeysRef.trim()
        : GLOBAL_API_KEYS_REF
    settings = {
      servers,
      defaultServerId,
      workingDirectory:
        typeof parsed.workingDirectory === `string`
          ? parsed.workingDirectory
          : null,
      apiKeysRef,
      onboardingDismissed: parsed.onboardingDismissed === true,
      mcp: normalizeMcp(parsed.mcp),
      pullWakeRunnerId,
    }
    if (parsed.apiKeys !== undefined) {
      apiKeys = normalizeApiKeys(parsed.apiKeys)
      await saveApiKeysToSecret(apiKeysRef, apiKeys)
      shouldSave = true
    } else {
      apiKeys = await loadApiKeysFromSecret(apiKeysRef)
    }
    shouldSave =
      shouldSave ||
      parsed.version !== SETTINGS_VERSION ||
      parsed.activeServer !== undefined ||
      parsed.apiKeys !== undefined ||
      servers.some((server) => !(`id` in (server as object)))
  } catch (err) {
    console.error(`[agents-desktop] Failed to load settings:`, err)
    settings = { ...DEFAULT_SETTINGS, pullWakeRunnerId: randomUUID() }
    apiKeys = await loadApiKeysFromSecret(settings.apiKeysRef)
    shouldSave = true
  }

  if (
    PULL_WAKE_RUNNER_ID &&
    settings.pullWakeRunnerId !== PULL_WAKE_RUNNER_ID
  ) {
    settings.pullWakeRunnerId = PULL_WAKE_RUNNER_ID
    shouldSave = true
  }

  for (const server of settings.servers) {
    ensureRuntimeEntry(server)
  }

  state = desktopStateForWindow(null)
  await applyInitialServerFromEnv()
  applyApiKeys()
  if (shouldSave) {
    await saveSettings()
  }
}

async function saveSettings(): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(serializeSettings(), null, 2))
}

// Memory holds `mcp.servers` as the array `BuiltinAgentsServer.extraMcpServers`
// expects. On disk we mirror `mcp.json`'s keyed-by-name shape so users can
// copy entries between the two files. This re-keys the array before write.
function serializeSettings(): Record<string, unknown> {
  const { mcp, ...rest } = settings
  const base = { version: SETTINGS_VERSION, ...rest }
  if (!mcp || mcp.servers.length === 0) return base
  const servers: Record<string, Record<string, unknown>> = {}
  for (const s of mcp.servers) {
    const { name, ...entry } = s as McpServerConfig & Record<string, unknown>
    servers[name] = entry
  }
  return { ...base, mcp: { servers } }
}

function createConnectionState(entry: RuntimeEntry): ServerConnectionState {
  return {
    serverId: entry.serverId,
    status: entry.status,
    localRuntimeStatus: entry.localRuntimeStatus,
    runtimeUrl: entry.runtimeUrl,
    runtimeError: entry.runtimeError,
    lastError: entry.lastError,
    reconnectAttempt: entry.reconnectAttempt,
    lastConnectedAt: entry.lastConnectedAt,
  }
}

function ensureRuntimeEntry(server: ServerConfig): RuntimeEntry {
  const existing = runtimeEntries.get(server.id)
  if (existing) {
    existing.desiredState = server.desiredState
    if (!server.localRuntimeEnabled && !existing.runtime) {
      existing.localRuntimeStatus = `disabled`
    } else if (
      server.localRuntimeEnabled &&
      existing.localRuntimeStatus === `disabled`
    ) {
      existing.localRuntimeStatus = `stopped`
    }
    if (server.desiredState === `disconnected` && !existing.runtime) {
      existing.status = `disconnected`
    }
    return existing
  }
  const entry: RuntimeEntry = {
    serverId: server.id,
    desiredState: server.desiredState,
    status: server.desiredState === `connected` ? `offline` : `disconnected`,
    localRuntimeStatus: server.localRuntimeEnabled ? `stopped` : `disabled`,
    runtime: null,
    runtimeUrl: null,
    runtimeError: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    generation: 0,
    lastError: null,
    lastConnectedAt: null,
    mcpUnsubscribe: null,
  }
  runtimeEntries.set(server.id, entry)
  return entry
}

function selectedServerIdForWindow(win: BrowserWindow | null): string | null {
  if (win && !win.isDestroyed()) {
    const existing = windowSelections.get(win.id)
    if (existing && findServer(existing)) return existing
  }
  return defaultSelectedServerId()
}

function runtimeStatusForConnection(
  entry: RuntimeEntry | null
): DesktopRuntimeStatus {
  if (!entry) return `stopped`
  switch (entry.localRuntimeStatus) {
    case `running`:
      return `running`
    case `starting`:
      return `starting`
    case `error`:
      return `error`
    case `disabled`:
    case `stopped`:
      return `stopped`
  }
}

function connectionStatusLabel(status: ServerConnectionStatus): string {
  switch (status) {
    case `connected`:
      return `Connected`
    case `connecting`:
      return `Connecting`
    case `reconnecting`:
      return `Reconnecting`
    case `offline`:
      return `Offline`
    case `error`:
      return `Error`
    case `disconnected`:
      return `Disconnected`
  }
}

function localRuntimeStatusLabel(status: LocalRuntimeStatus): string {
  switch (status) {
    case `disabled`:
      return `Disabled`
    case `stopped`:
      return `Stopped`
    case `starting`:
      return `Starting`
    case `running`:
      return `Running`
    case `error`:
      return `Error`
  }
}

function injectDevPrincipalHeaders(server: ServerConfig): ServerConfig {
  if (!DEV_PRINCIPAL) return server
  return {
    ...server,
    headers: { ...server.headers, [ELECTRIC_PRINCIPAL_HEADER]: DEV_PRINCIPAL },
  }
}

function desktopStateForWindow(win: BrowserWindow | null): DesktopState {
  const selectedServerId = selectedServerIdForWindow(win)
  const activeServer = findServer(selectedServerId)
  const entry = activeServer ? ensureRuntimeEntry(activeServer) : null
  return {
    servers: settings.servers,
    selectedServerId,
    connections: settings.servers.map((server) =>
      createConnectionState(ensureRuntimeEntry(server))
    ),
    runtimeStatus: runtimeStatusForConnection(entry),
    runtimeUrl: entry?.runtimeUrl ?? null,
    activeServer: activeServer ? injectDevPrincipalHeaders(activeServer) : null,
    workingDirectory: settings.workingDirectory,
    error: entry?.lastError ?? null,
    discoveredServers: state.discoveredServers,
    pullWakeRunnerId: PULL_WAKE_RUNNER_ID ?? settings.pullWakeRunnerId ?? null,
  }
}

function sendCommand(command: DesktopCommand): void {
  const focused = BrowserWindow.getFocusedWindow()
  const target =
    focused ?? [...windows].find((win) => !win.isDestroyed()) ?? null
  target?.webContents.send(`desktop:command`, command)
}

function createTrayIcon(): Electron.NativeImage {
  // Electric brand mark rasterised to 26×22 (1×) and 51×44 (2×)
  // black-on-transparent PNGs in `assets/`. We add the @2x variant as
  // a representation so retina menu bars stay crisp; macOS template
  // mode then auto-recolors for light/dark menu bars.
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH)
  try {
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: nativeImage.createFromPath(TRAY_ICON_2X_PATH).toPNG(),
    })
  } catch {
    // @2x asset missing — fall back to single-resolution.
  }
  if (process.platform === `darwin`) {
    icon.setTemplateImage(true)
  }
  return icon
}

function updateTray(): void {
  if (!tray) return

  const connectedCount = [...runtimeEntries.values()].filter(
    (entry) => entry.status === `connected`
  ).length
  const connectingCount = [...runtimeEntries.values()].filter(
    (entry) => entry.status === `connecting` || entry.status === `reconnecting`
  ).length
  const runtimeLabel =
    connectedCount > 0
      ? `${connectedCount} connected`
      : connectingCount > 0
        ? `${connectingCount} connecting`
        : `No connected servers`
  tray.setToolTip(`Electric Agents: ${runtimeLabel}`)

  const menu = Menu.buildFromTemplate([
    {
      label: `Open Agents`,
      click: () => createWindow(),
    },
    {
      label: `New Window`,
      click: () => createWindow(),
    },
    { type: `separator` },
    {
      label: `Servers: ${runtimeLabel}`,
      enabled: false,
    },
    ...settings.servers.map((server): Electron.MenuItemConstructorOptions => {
      const entry = ensureRuntimeEntry(server)
      return {
        label: `${server.name}: ${connectionStatusLabel(entry.status)}`,
        submenu: [
          {
            label: `Connection: ${connectionStatusLabel(entry.status)}`,
            enabled: false,
          },
          {
            label: `Local runtime: ${localRuntimeStatusLabel(entry.localRuntimeStatus)}`,
            enabled: false,
          },
          ...(entry.runtimeUrl
            ? ([
                {
                  label: entry.runtimeUrl,
                  enabled: false,
                },
              ] as Electron.MenuItemConstructorOptions[])
            : []),
          ...(entry.runtimeError
            ? ([
                {
                  label: `Runtime error: ${entry.runtimeError}`,
                  enabled: false,
                },
              ] as Electron.MenuItemConstructorOptions[])
            : []),
          ...(entry.lastError
            ? ([
                {
                  label: `Connection error: ${entry.lastError}`,
                  enabled: false,
                },
              ] as Electron.MenuItemConstructorOptions[])
            : []),
          { type: `separator` },
          {
            label: `Server Settings…`,
            click: () => sendCommand(`open-servers-settings`),
          },
          { type: `separator` },
          {
            label:
              entry.desiredState === `connected` ? `Disconnect` : `Connect`,
            click: () => {
              if (entry.desiredState === `connected`) {
                void disconnectServer(server.id)
              } else {
                void connectServer(server.id)
              }
            },
          },
          {
            label: server.localRuntimeEnabled
              ? `Disable Local Runtime`
              : `Enable Local Runtime`,
            click: () => {
              server.localRuntimeEnabled = !server.localRuntimeEnabled
              void saveSettings().then(async () => {
                const nextEntry = ensureRuntimeEntry(server)
                if (!server.localRuntimeEnabled && nextEntry.runtime) {
                  await stopRuntimeEntry(nextEntry)
                } else if (
                  server.localRuntimeEnabled &&
                  server.desiredState === `connected`
                ) {
                  await restartRuntime(server.id)
                }
                refreshDesktopState()
              })
            },
          },
          {
            label: `Restart Local Runtime`,
            enabled:
              entry.desiredState === `connected` && server.localRuntimeEnabled,
            click: () => {
              void restartRuntime(server.id)
            },
          },
        ],
      }
    }),
    { type: `separator` },
    {
      label: `Quit`,
      click: () => {
        void quitApp()
      },
    },
  ])

  tray.setContextMenu(menu)
}

function broadcastState(): void {
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:state-changed`, desktopStateForWindow(win))
    }
  }
}

function getNavigationState(win: BrowserWindow): DesktopNavigationState {
  return {
    canGoBack: win.webContents.canGoBack(),
    canGoForward: win.webContents.canGoForward(),
  }
}

function sendNavigationState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(
    `desktop:navigation-state-changed`,
    getNavigationState(win)
  )
}

function sendFullscreenState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(`desktop:fullscreen-state-changed`, win.isFullScreen())
}

function setState(patch: Partial<DesktopState>): void {
  state = { ...state, ...patch }
  updateTray()
  broadcastState()
}

function refreshDesktopState(): void {
  state = desktopStateForWindow(null)
  updateTray()
  broadcastState()
}

function createWindow(): BrowserWindow {
  const isMac = process.platform === `darwin`
  const isWindows = process.platform === `win32`
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: `Electric Agents`,
    // macOS: hide the native titlebar but keep the traffic-light buttons
    // overlaid on the window content. The renderer paints the toolbar
    // with extra left-padding so its icons sit to the right of the
    // traffic lights and the row reads as a single chrome strip.
    // macOS keeps the native traffic lights in a hiddenInset titlebar.
    // Windows/Linux use a hidden titlebar plus Electron's native
    // window-controls overlay so the renderer can paint a Cursor-style
    // icon/menu strip on the same row as the minimize/maximize/close
    // controls.
    titleBarStyle: isMac ? `hiddenInset` : `hidden`,
    frame: true,
    autoHideMenuBar: !isMac,
    // Keep true transparent windows macOS-only. On Windows, `transparent: true`
    // creates a layered window, which drops the native DWM border, rounded
    // corners, and shadow. Mica is applied via `backgroundMaterial` instead.
    transparent: isMac,
    backgroundColor: isMac ? `#00000000` : undefined,
    vibrancy: isMac ? `sidebar` : undefined,
    visualEffectState: isMac ? `active` : undefined,
    backgroundMaterial: isWindows ? `mica` : undefined,
    titleBarOverlay: isMac
      ? undefined
      : {
          color: isWindows ? `#00000000` : `#f7f7f7`,
          symbolColor: `#1f2328`,
          height: 34,
        },
    // Standard macOS hiddenInset traffic-light origin (top-left of the
    // leftmost light). The renderer matches the 44px desktop header
    // height so the 24px IconButton glyphs flex-center to the same y as
    // the light centers — the row reads as a single chrome strip.
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isMac) {
    win.setVibrancy(`sidebar`)
  } else if (isWindows) {
    win.setBackgroundMaterial(`mica`)
  }

  windows.add(win)
  windowSelections.set(win.id, defaultSelectedServerId())
  if (!isMac) {
    win.setMenuBarVisibility(false)
  }
  installEditableContextMenu(win)
  installExternalLinkHandler(win)
  installNavigationStateBridge(win)
  win.on(`enter-full-screen`, () => sendFullscreenState(win))
  win.on(`leave-full-screen`, () => sendFullscreenState(win))
  win.webContents.on(`did-finish-load`, () => sendFullscreenState(win))
  win.on(`closed`, () => {
    windows.delete(win)
    windowSelections.delete(win.id)
    buildApplicationMenu()
  })
  // The renderer keeps `document.title` in sync with the active tile's
  // entity (see `useDocumentTitle.ts`). Forwarding `page-title-updated`
  // into a menu rebuild lets the Window submenu show one entry per
  // open window labelled with that window's active session.
  win.webContents.on(`page-title-updated`, () => {
    buildApplicationMenu()
  })
  win.on(`focus`, () => {
    buildApplicationMenu()
  })
  // Dev: load from the running Vite dev server so the renderer gets
  // HMR (CSS / React Refresh / module replacement). Production: load
  // the prebuilt `dist-desktop/index.html` from disk via file://.
  // DevTools are not auto-opened — multi-window setups would spawn
  // a detached DevTools per window, which gets noisy fast. The
  // standard `View → Toggle Developer Tools` menu item (Cmd+Opt+I /
  // Ctrl+Shift+I) works in every window when you actually need it.
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(RENDERER_INDEX)
  }
  buildApplicationMenu()

  return win
}

function installNavigationStateBridge(win: BrowserWindow): void {
  const notify = () => sendNavigationState(win)
  win.webContents.on(`did-finish-load`, notify)
  win.webContents.on(`did-navigate`, notify)
  win.webContents.on(`did-navigate-in-page`, notify)
}

function isExternalLink(url: string): boolean {
  try {
    return EXTERNAL_LINK_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

function installExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) {
      void shell.openExternal(url)
    }
    return { action: `deny` }
  })

  win.webContents.on(`will-navigate`, (event, url) => {
    if (!isExternalLink(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

function installEditableContextMenu(win: BrowserWindow): void {
  win.webContents.on(`context-menu`, (_event, params) => {
    if (params.linkURL && isExternalLink(params.linkURL)) {
      showLinkContextMenu(win, params.linkURL)
      return
    }

    if (!params.isEditable) return

    const template: Array<Electron.MenuItemConstructorOptions> = []
    const suggestions = params.dictionarySuggestions.slice(0, 5)

    if (params.misspelledWord) {
      if (suggestions.length > 0) {
        for (const suggestion of suggestions) {
          template.push({
            label: suggestion,
            click: () => win.webContents.replaceMisspelling(suggestion),
          })
        }
      } else {
        template.push({ label: `No Guesses Found`, enabled: false })
      }

      template.push({
        label: `Learn Spelling`,
        click: () => {
          win.webContents.session.addWordToSpellCheckerDictionary(
            params.misspelledWord
          )
        },
      })
      template.push({ type: `separator` })
    }

    template.push(
      { role: `undo`, enabled: params.editFlags.canUndo },
      { role: `redo`, enabled: params.editFlags.canRedo },
      { type: `separator` },
      { role: `cut`, enabled: params.editFlags.canCut },
      { role: `copy`, enabled: params.editFlags.canCopy },
      { role: `paste`, enabled: params.editFlags.canPaste },
      {
        role: `pasteAndMatchStyle`,
        enabled: params.editFlags.canPaste,
      },
      { role: `delete`, enabled: params.editFlags.canDelete },
      { type: `separator` },
      { role: `selectAll`, enabled: params.editFlags.canSelectAll }
    )

    Menu.buildFromTemplate(template).popup({ window: win })
  })
}

function showLinkContextMenu(win: BrowserWindow, url: string): void {
  Menu.buildFromTemplate([
    {
      label: `Open Link in Browser`,
      click: () => {
        void shell.openExternal(url)
      },
    },
    {
      label: `Copy Link`,
      click: () => clipboard.writeText(url),
    },
  ]).popup({ window: win })
}

function showSelectionContextMenu(
  win: BrowserWindow,
  request: DesktopContextMenuRequest
): void {
  const selectionText = request.selectionText.trim()
  if (selectionText.length === 0) return

  Menu.buildFromTemplate([
    {
      label: `Copy`,
      accelerator: `CmdOrCtrl+C`,
      click: () => clipboard.writeText(selectionText),
    },
  ]).popup({ window: win })
}

function showOrCreateWindow(): void {
  const existing = [...windows].find((win) => !win.isDestroyed())
  if (existing) {
    existing.show()
    existing.focus()
    return
  }
  createWindow()
}

async function stopExistingRuntime(): Promise<void> {
  await Promise.all(
    [...runtimeEntries.values()].map(async (entry) => {
      await stopRuntimeEntry(entry)
      entry.status =
        entry.desiredState === `connected` ? `offline` : `disconnected`
    })
  )
}

type AgentsServerHealthResult = { ok: true } | { ok: false; reason: string }

function buildAgentsServerHealthUrl(baseUrl: string): string {
  try {
    return appendPathToServerUrl(baseUrl, `/_electric/health`)
  } catch {
    const trimmed = baseUrl.replace(/\/+$/, ``)
    return `${trimmed}/_electric/health`
  }
}

function appendPathToServerUrl(baseUrl: string, pathName: string): string {
  const base = new URL(baseUrl)
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  const suffix = pathName.startsWith(`/`) ? pathName : `/${pathName}`
  base.pathname = `${basePath}${suffix}`
  base.search = ``
  base.hash = ``
  return base.toString()
}

function formatStartupNetworkError(
  error: unknown,
  activeServerUrl: string
): string | null {
  if (!(error instanceof Error)) return null
  if (!/fetch failed/i.test(error.message)) return null
  const cause = (error as Error & { cause?: unknown }).cause
  const details =
    cause && typeof cause === `object` && `code` in cause
      ? String((cause as { code?: unknown }).code ?? ``).trim()
      : ``
  const suffix = details ? ` (${details})` : ``
  return [
    `Could not connect to agents-server at ${activeServerUrl}.`,
    `Make sure it is running, then retry.${suffix}`,
  ].join(` `)
}

async function checkAgentsServerHealth(
  baseUrl: string,
  timeoutMs: number
): Promise<AgentsServerHealthResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const healthUrl = buildAgentsServerHealthUrl(baseUrl)
  // Auth for cloud-server health checks is added by the global
  // undici interceptor installed in `installCloudAuthHeaderInjection`
  // — no per-call-site plumbing needed.
  try {
    const res = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { accept: `application/json` },
    })
    if (!res.ok) {
      return {
        ok: false,
        reason: `health check returned ${res.status}`,
      }
    }
    const json = (await res.json()) as { status?: unknown }
    if (json?.status !== `ok`) {
      return {
        ok: false,
        reason: `health check returned an unexpected response`,
      }
    }
    return { ok: true }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === `AbortError`
        ? `health check timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error)
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}

function broadcastMcpSnapshot(
  serverId: string,
  snapshot: RegistrySnapshot
): void {
  lastMcpSnapshots.set(serverId, snapshot)
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:mcp-state`, { serverId, snapshot })
    }
  }
}

async function handleAuthorizeUrl(
  serverId: string,
  url: string,
  server: string
): Promise<void> {
  const reg = runtimeEntries.get(serverId)?.runtime?.mcpRegistry
  if (!reg) return
  const redirectUriPrefix = `${MCP_OAUTH_REDIRECT_BASE}/oauth/callback/${server}`
  try {
    const focused = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await openAuthorizeWindow({
      server,
      authorizeUrl: url,
      redirectUriPrefix,
      parent: focused ?? undefined,
    })
    await reg.finishAuth(result.server, result.code, result.state)
  } catch (err) {
    // Cancelled / closed without completing. The registry stays in
    // `authenticating`; the user can click Authorize again to retry.
    console.warn(`[agents-desktop] OAuth flow for ${server}:`, err)
  }
}

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * Math.max(1, 2 ** Math.min(attempt, 5))
  )
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

function scheduleReconnect(serverId: string): void {
  const server = findServer(serverId)
  const entry = server ? ensureRuntimeEntry(server) : null
  if (!server || !entry || entry.desiredState !== `connected`) return
  if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
  const delay = reconnectDelayMs(entry.reconnectAttempt)
  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null
    void startRuntime(serverId)
  }, delay)
  refreshDesktopState()
}

async function stopRuntimeEntry(entry: RuntimeEntry): Promise<void> {
  entry.generation += 1
  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer)
    entry.reconnectTimer = null
  }
  if (entry.mcpUnsubscribe) {
    entry.mcpUnsubscribe()
    entry.mcpUnsubscribe = null
  }
  lastMcpSnapshots.delete(entry.serverId)
  broadcastMcpSnapshot(entry.serverId, { seq: 0, servers: [] })
  const current = entry.runtime
  entry.runtime = null
  entry.runtimeUrl = null
  entry.runtimeError = null
  entry.localRuntimeStatus = findServer(entry.serverId)?.localRuntimeEnabled
    ? `stopped`
    : `disabled`
  if (current) {
    await current.stop()
  }
}

async function startRuntime(serverId: string): Promise<void> {
  const activeServer = findServer(serverId)
  if (!activeServer) return
  const entry = ensureRuntimeEntry(activeServer)
  if (entry.desiredState !== `connected`) return

  await stopRuntimeEntry(entry)
  if (entry.desiredState !== `connected`) return
  const generation = ++entry.generation

  entry.status = entry.reconnectAttempt > 0 ? `reconnecting` : `connecting`
  entry.lastError = null
  refreshDesktopState()

  if (activeServer.source === `electric-cloud`) {
    if (!activeServer.tenantId) {
      entry.status = `error`
      entry.lastError = `Cloud server ${activeServer.name} is missing a tenant id.`
      refreshDesktopState()
      return
    }
    try {
      const prepared = await getCloudAgentServers().prepareConnection(
        activeServer.tenantId
      )
      if (prepared.url !== activeServer.url) {
        activeServer.url = prepared.url
        await saveSettings()
      }
    } catch (err) {
      const cachedToken = getCloudAgentServers().getAgentsToken(
        activeServer.tenantId
      )
      if (!cachedToken) {
        entry.status = `error`
        entry.lastError = `Could not prepare cloud agents token for ${activeServer.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
        refreshDesktopState()
        return
      }
      console.warn(`[agents-desktop] cloud agents token refresh failed:`, err)
    }
  }

  const serverHealth = await checkAgentsServerHealth(activeServer.url, 4_000)
  if (!serverHealth.ok) {
    entry.status = `offline`
    entry.lastError = `Could not reach agents-server at ${activeServer.url}: ${serverHealth.reason}.`
    entry.reconnectAttempt += 1
    scheduleReconnect(serverId)
    return
  }

  if (!activeServer.localRuntimeEnabled) {
    entry.status = `connected`
    entry.localRuntimeStatus = `disabled`
    entry.runtimeUrl = null
    entry.runtimeError = null
    entry.lastError = null
    entry.reconnectAttempt = 0
    entry.lastConnectedAt = Date.now()
    refreshDesktopState()
    return
  }

  const runnerId = PULL_WAKE_RUNNER_ID ?? settings.pullWakeRunnerId
  if (!runnerId) {
    throw new Error(`Desktop built-in agents require a pull-wake runner id`)
  }
  if (!settings.pullWakeRunnerId) {
    settings.pullWakeRunnerId = runnerId
    await saveSettings()
  }
  setState({ pullWakeRunnerId: runnerId })

  const serverWithPrincipal = injectDevPrincipalHeaders(activeServer)
  const runtimeHeaders = mergeHeaders(serverWithPrincipal.headers)
  // For `electric-cloud` source servers, the cloud-agents-server
  // authenticates each request via `x-electric-asserted-user-id`
  // headers (injected by the undici / webRequest hooks) and checks
  // the pull-wake `owner_user_id` against that asserted user. So the
  // runner must register with the cloud user's id, not the
  // `local-desktop` fallback we use for unauthenticated local servers.
  const cloudAuthUserId =
    activeServer.source === `electric-cloud`
      ? (cloudAuth?.getState().userId ?? null)
      : null
  const runnerOwnerUserId =
    cloudAuthUserId ?? runnerOwnerUserIdFromHeaders(runtimeHeaders)
  console.info(
    `[agents-desktop] Starting built-in agents runtime for server ${activeServer.url}`
  )
  console.info(`[agents-desktop] Pull-wake runner id: ${runnerId}`)
  if (PULL_WAKE_REGISTER_RUNNER) {
    console.info(
      `[agents-desktop] Pull-wake runner registration enabled; owner user id: ${runnerOwnerUserId}`
    )
  } else {
    console.info(
      `[agents-desktop] Pull-wake runner registration skipped; runner must already be registered with the agents server.`
    )
  }

  configureRuntimeEnvironment()
  applyApiKeys()
  const { BuiltinAgentsServer } = await import(`@electric-ax/agents`)
  const nextRuntime = new BuiltinAgentsServer({
    agentServerUrl: activeServer.url,
    workingDirectory: settings.workingDirectory ?? app.getPath(`home`),
    extraMcpServers: settings.mcp?.servers,
    loadProjectMcpConfig: true,
    mcpOAuthRedirectBase: MCP_OAUTH_REDIRECT_BASE,
    baseSkillsDir: AGENT_SKILLS_DIR,
    openAuthorizeUrl: (url, server) => {
      void handleAuthorizeUrl(serverId, url, server)
    },
    pullWake: {
      runnerId,
      registerRunner: PULL_WAKE_REGISTER_RUNNER,
      ownerUserId: PULL_WAKE_REGISTER_RUNNER ? runnerOwnerUserId : undefined,
      label: `Electric Agents Desktop`,
      headers: runtimeHeaders,
      claimHeaders: runtimeHeaders,
      // For `electric-cloud` source servers the global undici
      // interceptor adds `Authorization: Bearer <agents token>` on
      // every outbound request. If the pull-wake runner default-
      // stuffed the claim token into that same `authorization`
      // header, our interceptor would overwrite it and the cloud
      // server would never see the claim token → wake claim races
      // would silently drop the new input ("no fresh wake input in
      // catch-up"). Route the claim token to a separate header so
      // the two channels don't collide. Local + manual servers keep
      // the previous behavior (claim token in `authorization` only
      // when an explicit auth header is present).
      claimTokenHeader:
        activeServer.source === `electric-cloud` ||
        hasHeader(runtimeHeaders, `authorization`)
          ? `electric-claim-token`
          : undefined,
    },
  })
  entry.runtime = nextRuntime
  entry.localRuntimeStatus = `starting`
  entry.runtimeError = null
  refreshDesktopState()

  try {
    const runtimeUrl = await nextRuntime.start()
    if (generation !== entry.generation) {
      await nextRuntime.stop()
      return
    }
    entry.status = `connected`
    entry.localRuntimeStatus = `running`
    entry.runtimeUrl = runtimeUrl
    entry.runtimeError = null
    entry.lastError = null
    entry.reconnectAttempt = 0
    entry.lastConnectedAt = Date.now()
    refreshDesktopState()
    // Subscribe to MCP registry state changes and forward to renderers.
    // The handler is invoked synchronously with the initial empty
    // snapshot on subscribe, so renderers always see *something*.
    const reg = nextRuntime.mcpRegistry
    if (reg) {
      entry.mcpUnsubscribe = reg.subscribe((snapshot: RegistrySnapshot) => {
        broadcastMcpSnapshot(serverId, snapshot)
      })
    }
  } catch (error) {
    if (entry.runtime === nextRuntime) {
      entry.runtime = null
    }
    const startupNetworkError = formatStartupNetworkError(
      error,
      activeServer.url
    )
    entry.status = `error`
    entry.localRuntimeStatus = `error`
    entry.runtimeUrl = null
    entry.runtimeError =
      startupNetworkError ??
      (error instanceof Error ? error.message : String(error))
    entry.lastError =
      startupNetworkError ??
      (error instanceof Error ? error.message : String(error))
    entry.reconnectAttempt += 1
    scheduleReconnect(serverId)
  }
}

async function connectServer(serverId: string): Promise<void> {
  const server = findServer(serverId)
  if (!server) return
  server.desiredState = `connected`
  const entry = ensureRuntimeEntry(server)
  entry.desiredState = `connected`
  entry.reconnectAttempt = 0
  await saveSettings()
  await startRuntime(serverId)
}

async function disconnectServer(serverId: string): Promise<void> {
  const server = findServer(serverId)
  if (!server) return
  server.desiredState = `disconnected`
  const entry = ensureRuntimeEntry(server)
  entry.desiredState = `disconnected`
  await stopRuntimeEntry(entry)
  entry.status = `disconnected`
  entry.lastError = null
  entry.reconnectAttempt = 0
  await saveSettings()
  refreshDesktopState()
}

async function restartRuntime(serverId?: string | null): Promise<void> {
  const id =
    serverId ??
    selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
    settings.defaultServerId
  if (!id) return
  const server = findServer(id)
  if (!server) return
  server.desiredState = `connected`
  const entry = ensureRuntimeEntry(server)
  entry.desiredState = `connected`
  entry.reconnectAttempt = 0
  await saveSettings()
  await startRuntime(id)
}

async function stopRuntime(serverId?: string | null): Promise<void> {
  const id =
    serverId ??
    selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
    settings.defaultServerId
  if (!id) return
  await disconnectServer(id)
}

function getApiKeysStatus(): ApiKeysStatus {
  const saved = apiKeys
  // Brave is optional (falls back to Anthropic built-in search), so
  // it doesn't count toward "the app is configured" — the dialog
  // only auto-opens when the user has no LLM provider key at all.
  const hasAnyKey = Boolean(saved.anthropic || saved.openai)
  // Only suggest env values for slots the user hasn't already saved
  // — once they've persisted a key for a provider, the dialog should
  // show their saved value rather than the (potentially different)
  // environment value.
  const suggested: ApiKeys = {
    anthropic: saved.anthropic ? null : ENV_API_KEYS_SNAPSHOT.anthropic,
    openai: saved.openai ? null : ENV_API_KEYS_SNAPSHOT.openai,
    brave: saved.brave ? null : ENV_API_KEYS_SNAPSHOT.brave,
  }
  return { hasAnyKey, saved, suggested }
}

async function setApiKeys(next: ApiKeys): Promise<void> {
  apiKeys = normalizeApiKeys(next)
  await saveApiKeysToSecret(settings.apiKeysRef, apiKeys)
  applyApiKeys()
  await saveSettings()
  await Promise.all(
    settings.servers
      .filter((server) => server.desiredState === `connected`)
      .map((server) => restartRuntime(server.id))
  )
}

/**
 * Snapshot consumed by the renderer's onboarding wizard. `dismissed`
 * is the persisted "Don't show again" flag; `hasAnyKey` lets the
 * wizard skip the API-keys step when keys already exist; `signedIn`
 * lets it skip the Electric Cloud step when a session is already
 * restored. The renderer decides whether to render the modal based on
 * those three bits — the main process doesn't make the policy call.
 */
type OnboardingState = {
  dismissed: boolean
  hasAnyKey: boolean
  signedIn: boolean
}

function getOnboardingState(): OnboardingState {
  const cloudStatus = cloudAuth?.getState().status
  return {
    dismissed: settings.onboardingDismissed === true,
    hasAnyKey: Boolean(apiKeys.anthropic || apiKeys.openai),
    signedIn: cloudStatus === `signed-in`,
  }
}

async function setOnboardingDismissed(dismissed: boolean): Promise<void> {
  settings.onboardingDismissed = dismissed
  await saveSettings()
}

async function setSelectedServerForWindow(
  win: BrowserWindow | null,
  serverId: string | null
): Promise<void> {
  const next = findServer(serverId)?.id ?? null
  if (win && !win.isDestroyed()) {
    windowSelections.set(win.id, next)
  }
  settings.defaultServerId = next
  await saveSettings()
  refreshDesktopState()
}

async function setActiveServer(
  win: BrowserWindow | null,
  server: ServerConfig | null
): Promise<void> {
  const normalized = normalizeServer(server)
  const existing =
    normalized &&
    settings.servers.find(
      (candidate) =>
        candidate.id === normalized.id || candidate.url === normalized.url
    )
  await setSelectedServerForWindow(win, existing?.id ?? null)
}

async function quitApp(): Promise<void> {
  if (isQuitting) return
  isQuitting = true
  stopDiscoveryLoop()
  await stopExistingRuntime().catch(() => {})
  app.quit()
}

/**
 * Localhost ports we probe for running `agents-server` instances.
 *
 * - 4437: `packages/agents-server` `DEFAULT_PORT`.
 * - 4438/4439: common offsets when running multiple servers side-by-side.
 * - 3000/4000/8080: common Node/dev defaults users sometimes pick.
 *
 * Identification is via `GET /_electric/health` returning
 * `{ status: "ok" }` (see `ElectricAgentsServer.handleRequestInner`),
 * so collisions with unrelated services on these ports are filtered out.
 */
const DISCOVERY_PORTS: ReadonlyArray<number> = [
  4437, 4438, 4439, 3000, 4000, 8080,
]
const DISCOVERY_TIMEOUT_MS = 1500
const DISCOVERY_INTERVAL_MS = 30_000

let discoveryTimer: NodeJS.Timeout | null = null
let discoveryInFlight: Promise<void> | null = null

async function probeAgentsServer(url: string): Promise<boolean> {
  const result = await checkAgentsServerHealth(url, DISCOVERY_TIMEOUT_MS)
  return result.ok
}

async function runDiscovery(): Promise<void> {
  if (discoveryInFlight) {
    await discoveryInFlight
    return
  }
  discoveryInFlight = (async () => {
    // Don't probe the bundled runtime URL — that's our own Horton
    // process and isn't a separate agents-server.
    const skipPorts = new Set(
      [...runtimeEntries.values()]
        .map((entry) => {
          try {
            return entry.runtimeUrl ? new URL(entry.runtimeUrl).port : null
          } catch {
            return null
          }
        })
        .filter((port): port is string => Boolean(port))
    )
    const results = await Promise.all(
      DISCOVERY_PORTS.map(async (port) => {
        if (skipPorts.has(String(port))) return null
        const url = `http://127.0.0.1:${port}`
        const ok = await probeAgentsServer(url)
        return ok ? { url, port, lastSeen: Date.now() } : null
      })
    )
    const found = results.filter(
      (entry): entry is DiscoveredServer => entry !== null
    )
    found.sort((a, b) => a.port - b.port)

    const prev = state.discoveredServers
    const same =
      prev.length === found.length &&
      prev.every((entry, i) => entry.url === found[i]?.url)
    if (same) {
      // Same set of URLs — keep prior `lastSeen` to avoid noisy
      // broadcasts to renderers every tick.
      return
    }
    setState({ discoveredServers: found })
  })()
  try {
    await discoveryInFlight
  } finally {
    discoveryInFlight = null
  }
}

function startDiscoveryLoop(): void {
  if (discoveryTimer) return
  void runDiscovery()
  discoveryTimer = setInterval(() => {
    void runDiscovery()
  }, DISCOVERY_INTERVAL_MS)
}

function stopDiscoveryLoop(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer)
    discoveryTimer = null
  }
}

function refreshNativeTitleBars(): void {
  const symbolColor = nativeTheme.shouldUseDarkColors ? `#ededee` : `#1f2328`
  for (const win of windows) {
    win.setTitleBarOverlay?.({
      color: `#00000000`,
      symbolColor,
      height: 34,
    })
  }
}

function applyNativeAppearance(appearance: DesktopAppearance): void {
  nativeTheme.themeSource = appearance
  refreshNativeTitleBars()
}

function registerIpcHandlers(): void {
  ipcMain.handle(`desktop:get-servers`, () => settings.servers)
  ipcMain.handle(
    `desktop:set-native-appearance`,
    (_event, appearance: DesktopAppearance) => {
      applyNativeAppearance(appearance)
    }
  )
  ipcMain.handle(
    `desktop:save-servers`,
    async (_event, servers: Array<ServerConfig>) => {
      const previous = new Map(settings.servers.map((s) => [s.url, s]))
      settings.servers = normalizeServers(servers).map((server) => ({
        ...server,
        desiredState:
          previous.get(server.url)?.desiredState ?? server.desiredState,
      }))
      for (const server of settings.servers) {
        const entry = ensureRuntimeEntry(server)
        if (!server.localRuntimeEnabled && entry.runtime) {
          await stopRuntimeEntry(entry)
          entry.localRuntimeStatus = `disabled`
          if (server.desiredState === `connected`) {
            entry.status = `connected`
            entry.lastError = null
            entry.lastConnectedAt = Date.now()
          }
        } else if (server.localRuntimeEnabled && entry.status === `connected`) {
          void restartRuntime(server.id)
        }
      }
      const liveIds = new Set(settings.servers.map((server) => server.id))
      for (const [id, entry] of runtimeEntries) {
        if (!liveIds.has(id)) {
          await stopRuntimeEntry(entry)
          runtimeEntries.delete(id)
        }
      }
      if (!findServer(settings.defaultServerId)) {
        settings.defaultServerId = settings.servers[0]?.id ?? null
      }
      await saveSettings()
      refreshDesktopState()
    }
  )
  ipcMain.handle(`desktop:get-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return desktopStateForWindow(win)
  })
  ipcMain.handle(
    `desktop:set-active-server`,
    async (_event, server: ServerConfig | null) => {
      const win = BrowserWindow.fromWebContents(_event.sender)
      await setActiveServer(win, server)
    }
  )
  ipcMain.handle(`desktop:set-selected-server`, async (event, serverId) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await setSelectedServerForWindow(
      win,
      typeof serverId === `string` ? serverId : null
    )
  })
  ipcMain.handle(`desktop:connect-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await connectServer(serverId)
  })
  ipcMain.handle(`desktop:disconnect-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await disconnectServer(serverId)
  })
  ipcMain.handle(
    `desktop:restart-runtime`,
    async (event, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      await restartRuntime(
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      )
    }
  )
  ipcMain.handle(`desktop:stop-runtime`, async (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    await stopRuntime(
      typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
    )
  })
  ipcMain.handle(`desktop:rescan-servers`, async () => {
    await runDiscovery()
    return state.discoveredServers
  })
  ipcMain.handle(`desktop:get-api-keys-status`, () => getApiKeysStatus())
  ipcMain.handle(`desktop:save-api-keys`, async (_event, keys: ApiKeys) => {
    await setApiKeys(keys)
  })
  ipcMain.handle(`desktop:get-onboarding-state`, () => getOnboardingState())
  ipcMain.handle(
    `desktop:set-onboarding-dismissed`,
    async (_event, dismissed: boolean) => {
      await setOnboardingDismissed(Boolean(dismissed))
    }
  )
  ipcMain.handle(
    `desktop:get-working-directory`,
    () => settings.workingDirectory
  )
  ipcMain.handle(`desktop:choose-working-directory`, async () => {
    const result = await dialog.showOpenDialog({
      properties: [`openDirectory`, `createDirectory`],
    })
    if (result.canceled) return settings.workingDirectory
    settings.workingDirectory = result.filePaths[0] ?? null
    setState({ workingDirectory: settings.workingDirectory })
    await saveSettings()
    await Promise.all(
      settings.servers
        .filter((server) => server.desiredState === `connected`)
        .map((server) => restartRuntime(server.id))
    )
    return settings.workingDirectory
  })
  // One-shot directory picker — does NOT mutate the runtime cwd or
  // restart anything. Used by the new-session screen so each spawned
  // session can carry its own `workingDirectory` spawn arg without
  // disturbing the global default. Returns `null` on cancel; caller
  // is responsible for treating the result as ephemeral and (if it
  // wants to remember it) plumbing it into recent-dirs storage.
  ipcMain.handle(
    `desktop:pick-directory`,
    async (_event, options?: { defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: [`openDirectory`, `createDirectory`],
        defaultPath: options?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    }
  )
  ipcMain.on(
    `desktop:show-context-menu`,
    (event, request: DesktopContextMenuRequest) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      if (request.kind === `selection`) {
        showSelectionContextMenu(win, request)
      }
    }
  )
  ipcMain.handle(
    `desktop:show-menu-section`,
    (
      event,
      section: DesktopMenuSection,
      bounds: DesktopMenuPopupBounds,
      menuState: DesktopMenuState
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      popupApplicationMenuSection(win, section, bounds, menuState)
    }
  )
  ipcMain.handle(
    `desktop:show-app-menu`,
    (event, bounds: DesktopMenuPopupBounds) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      popupAppIconMenu(win, bounds)
    }
  )
  ipcMain.handle(`desktop:get-navigation-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return {
        canGoBack: false,
        canGoForward: false,
      } satisfies DesktopNavigationState
    }
    return getNavigationState(win)
  })
  ipcMain.handle(
    `desktop:navigate-history`,
    (event, direction: `back` | `forward`) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      if (direction === `back` && win.webContents.canGoBack()) {
        win.webContents.goBack()
      } else if (direction === `forward` && win.webContents.canGoForward()) {
        win.webContents.goForward()
      }
      sendNavigationState(win)
    }
  )

  // ── Electric Cloud auth IPC ─────────────────────────────────────
  // OAuth via dashboard.electric-sql.cloud's CLI flow: we open a child
  // BrowserWindow, the user signs in with GitHub/Google, the admin-API
  // 302s to the loopback `cli_port` redirect URI, and `CloudAuth`
  // intercepts that redirect to capture the JWT. State pushes come
  // through `desktop:cloud-auth-state-changed` (see broadcaster).
  ipcMain.handle(`desktop:cloud-auth-state`, () => getCloudAuth().getState())
  ipcMain.handle(
    `desktop:cloud-auth-sign-in`,
    async (event, provider: CloudAuthProvider) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
      await getCloudAuth().signIn(provider, parent)
    }
  )
  ipcMain.handle(`desktop:cloud-auth-sign-out`, async () => {
    await getCloudAuth().signOut()
  })
  ipcMain.handle(`desktop:cloud-auth-open-dashboard`, () => {
    getCloudAuth().openDashboard()
  })

  // ── Cloud agent servers ─────────────────────────────────────────
  // The user-scoped shape stream of agent stream services
  // (`/api/internal/v1/agent-servers`) joined client-side against the
  // workspaces / projects / environments shapes so the UI can label
  // each agent server with the workspace → project → environment it
  // belongs to. Lifecycle is driven from cloud-auth: streams start
  // when a JWT is available, stop on sign-out.
  ipcMain.handle(`desktop:cloud-agent-servers-state`, () =>
    getCloudAgentServers().getState()
  )
  // Prepare a URL the renderer can hand to the normal `addServer`
  // flow: hits the admin-API to mint a per-service agents bearer
  // token, stores that token in SecretStore, and returns only the
  // cloud agents base URL + tenant id. The renderer never sees the
  // user's cloud-auth bearer or the agents token.
  ipcMain.handle(
    `desktop:cloud-agent-server-prepare-connection`,
    async (_event, serviceId: string) => {
      return await getCloudAgentServers().prepareConnection(serviceId)
    }
  )

  // ── MCP registry IPC ─────────────────────────────────────────────
  // Renderers subscribe to `desktop:mcp-state` push events; this handler
  // returns the most recent snapshot so the renderer can render before
  // the next push lands. Empty list when no runtime is running.
  ipcMain.handle(`desktop:mcp-snapshot`, (event, serverId?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const id =
      typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
    return (id ? lastMcpSnapshots.get(id) : null) ?? { seq: 0, servers: [] }
  })
  // Mutation handlers — translate IPC calls into registry methods.
  // No-op gracefully when no runtime is running; renderer should not
  // depend on these throwing.
  ipcMain.handle(
    `desktop:mcp-authorize`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      const reg = id ? runtimeEntries.get(id)?.runtime?.mcpRegistry : null
      // Forces a fresh OAuth flow. The registry mutates the entry in
      // place rather than deleting + re-adding, so the renderer's
      // snapshot keeps showing the row throughout — no flicker.
      await reg?.reauthorize(name).catch((err: unknown) => {
        console.warn(`[agents-desktop] mcp-authorize ${name}:`, err)
      })
    }
  )
  ipcMain.handle(
    `desktop:mcp-reconnect`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      const reg = id ? runtimeEntries.get(id)?.runtime?.mcpRegistry : null
      const entry = reg?.get(name)
      if (!reg || !entry) return
      await reg.addServer(entry.config).catch((err: unknown) => {
        console.warn(`[agents-desktop] mcp-reconnect ${name}:`, err)
      })
    }
  )
  ipcMain.handle(
    `desktop:mcp-disable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await runtimeEntries
        .get(id ?? ``)
        ?.runtime?.mcpRegistry?.disable(name)
        .catch((err: unknown) => {
          console.warn(`[agents-desktop] mcp-disable ${name}:`, err)
        })
    }
  )
  ipcMain.handle(
    `desktop:mcp-enable`,
    async (event, name: string, serverId?: string) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const id =
        typeof serverId === `string` ? serverId : selectedServerIdForWindow(win)
      await runtimeEntries
        .get(id ?? ``)
        ?.runtime?.mcpRegistry?.enable(name)
        .catch((err: unknown) => {
          console.warn(`[agents-desktop] mcp-enable ${name}:`, err)
        })
    }
  )
}

function windowDisplayLabel(win: BrowserWindow): string {
  const raw = win.getTitle()
  if (!raw) return APP_DISPLAY_NAME
  // The renderer formats titles as `${session} — Electric Agents`.
  // Strip the suffix so the Window submenu reads cleanly as just the
  // session name (the menu already lives under "Electric Agents").
  const suffix = ` — ${APP_DISPLAY_NAME}`
  if (raw.endsWith(suffix)) {
    return raw.slice(0, -suffix.length) || APP_DISPLAY_NAME
  }
  return raw
}

/**
 * Custom About panel rendered as a small frameless `BrowserWindow`.
 *
 * The macOS native About panel only honours `iconPath` on Linux /
 * Windows — on darwin it always shows the bundle icon, which during
 * `electron .` dev mode is Electron's default atom. A standalone
 * window lets us show the real Electric mark and consistent
 * brand copy on every platform.
 */
function showAboutDialog(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }

  const iconBase64 = (() => {
    try {
      return readFileSync(APP_ICON_PATH).toString(`base64`)
    } catch {
      return ``
    }
  })()
  const iconSrc = iconBase64 ? `data:image/png;base64,${iconBase64}` : ``

  const html = `<!doctype html>
<html lang="en" data-electric-desktop="true">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>About ${APP_DISPLAY_NAME}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa;
    --fg: #15161a;
    --fg-muted: #6b6f78;
    --link: #1d6cff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1e22; --fg: #f1f2f4; --fg-muted: #a3a8b2; --link: #6aa3ff; }
  }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    -webkit-app-region: drag;
  }
  main {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 36px 28px 22px;
    gap: 10px;
  }
  .icon { width: 96px; height: 96px; image-rendering: -webkit-optimize-contrast; }
  .name { font-size: 19px; font-weight: 600; margin: 6px 0 0; letter-spacing: -0.01em; }
  .version { font-size: 12px; color: var(--fg-muted); margin: 0; }
  .tagline {
    font-size: 13px; font-weight: 500; margin: 14px 0 0;
    line-height: 1.45; max-width: 300px;
  }
  .body {
    font-size: 12px; color: var(--fg-muted); margin: 8px 0 0;
    line-height: 1.55; max-width: 300px;
  }
  .meta {
    font-size: 11px; color: var(--fg-muted);
    margin: 18px 0 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  a {
    color: var(--link); text-decoration: none;
    -webkit-app-region: no-drag;
  }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main>
    ${iconSrc ? `<img class="icon" src="${iconSrc}" alt="${APP_DISPLAY_NAME}" />` : ``}
    <h1 class="name">${APP_DISPLAY_NAME}</h1>
    <p class="version">Version ${app.getVersion() || `dev`}</p>
    <p class="tagline">The durable runtime for long-lived agents.</p>
    <p class="body">
      Built on Electric Streams, every agent sleeps when idle, wakes on
      demand and survives restarts — bringing durable, composable,
      serverless agents to the infrastructure you already run.
    </p>
    <div class="meta">
      <a href="https://electric.ax/agents/" target="_blank" rel="noreferrer">electric.ax/agents</a>
      <span>© ${new Date().getFullYear()} Electric DB Limited</span>
    </div>
  </main>
</body>
</html>`

  const win = new BrowserWindow({
    width: 380,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${APP_DISPLAY_NAME}`,
    titleBarStyle: process.platform === `darwin` ? `hiddenInset` : `default`,
    trafficLightPosition:
      process.platform === `darwin` ? { x: 12, y: 12 } : undefined,
    backgroundColor: `#f7f8fa`,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  aboutWindow = win
  win.setMenuBarVisibility(false)
  win.on(`closed`, () => {
    if (aboutWindow === win) aboutWindow = null
  })
  win.once(`ready-to-show`, () => win.show())
  // Open external links (electric.ax/agents) in the user's browser
  // instead of inside this little About window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: `deny` }
  })
  win.webContents.on(`will-navigate`, (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function buildApplicationMenuTemplate(): Array<Electron.MenuItemConstructorOptions> {
  const isMac = process.platform === `darwin`
  const focused = BrowserWindow.getFocusedWindow()
  const liveWindows = [...windows].filter((win) => !win.isDestroyed())

  // Sub-menu shared between File on Win/Linux and the application menu
  // on macOS. Each item maps to a renderer command implemented in the
  // shared `agents-server-ui` (see hooks under `src/hooks/`) so the
  // behaviour stays identical to the in-app buttons / hotkeys.
  const fileSubmenu: Array<Electron.MenuItemConstructorOptions> = [
    {
      label: `New Chat`,
      accelerator: `CommandOrControl+N`,
      click: () => sendCommand(`new-chat`),
    },
    {
      label: `New Window`,
      accelerator: `Shift+CommandOrControl+N`,
      click: () => createWindow(),
    },
    ...(!isMac
      ? ([
          { type: `separator` },
          {
            label: `Settings…`,
            accelerator: `CommandOrControl+,`,
            click: () => sendCommand(`open-settings`),
          },
        ] as Array<Electron.MenuItemConstructorOptions>)
      : []),
    { type: `separator` },
    {
      label: `Close Tile`,
      accelerator: `CommandOrControl+W`,
      click: () => sendCommand(`close-tile`),
    },
    {
      label: `Close Window`,
      accelerator: `Shift+CommandOrControl+W`,
      role: `close`,
    },
  ]

  return [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: `about` as const },
              { type: `separator` as const },
              {
                label: `Settings…`,
                accelerator: `CommandOrControl+,`,
                click: () => sendCommand(`open-settings`),
              },
              { type: `separator` as const },
              { role: `services` as const },
              { type: `separator` as const },
              { role: `hide` as const },
              { role: `hideOthers` as const },
              { role: `unhide` as const },
              { type: `separator` as const },
              {
                label: `Quit ${APP_DISPLAY_NAME}`,
                accelerator: `CommandOrControl+Q`,
                click: () => void quitApp(),
              },
            ],
          },
        ]
      : []),
    {
      label: `File`,
      submenu: fileSubmenu,
    },
    {
      label: `Edit`,
      submenu: [
        { role: `undo` },
        { role: `redo` },
        { type: `separator` },
        { role: `cut` },
        { role: `copy` },
        { role: `paste` },
        ...(isMac
          ? [
              { role: `pasteAndMatchStyle` as const },
              { role: `delete` as const },
            ]
          : [{ role: `delete` as const }]),
        { role: `selectAll` },
        { type: `separator` },
        {
          label: `Find in Pane…`,
          accelerator: `CommandOrControl+F`,
          click: () => sendCommand(`open-find`),
        },
        {
          label: `Find Next`,
          accelerator: `CommandOrControl+G`,
          click: () => sendCommand(`find-next`),
        },
        {
          label: `Find Previous`,
          accelerator: `Shift+CommandOrControl+G`,
          click: () => sendCommand(`find-previous`),
        },
      ],
    },
    {
      label: `View`,
      submenu: [
        {
          label: `Toggle Sidebar`,
          accelerator: `CommandOrControl+B`,
          click: () => sendCommand(`toggle-sidebar`),
        },
        {
          label: `Search Sessions…`,
          accelerator: `CommandOrControl+K`,
          click: () => sendCommand(`open-search`),
        },
        { type: `separator` },
        {
          label: `Split Right`,
          accelerator: `CommandOrControl+D`,
          click: () => sendCommand(`split-right`),
        },
        {
          label: `Split Down`,
          accelerator: `Shift+CommandOrControl+D`,
          click: () => sendCommand(`split-down`),
        },
        {
          label: `Cycle Tile`,
          accelerator: `CommandOrControl+\\`,
          click: () => sendCommand(`cycle-tile`),
        },
        { type: `separator` },
        { role: `togglefullscreen` },
        { role: `resetZoom` },
        { role: `zoomIn` },
        { role: `zoomOut` },
        { type: `separator` },
        { role: `reload` },
        { role: `forceReload` },
        { role: `toggleDevTools` },
      ],
    },
    {
      label: `Window`,
      submenu: [
        { role: `minimize` },
        { role: `zoom` },
        ...(isMac
          ? [{ type: `separator` as const }, { role: `front` as const }]
          : [{ role: `close` as const }]),
        ...(liveWindows.length > 0
          ? ([
              { type: `separator` },
              ...liveWindows.map(
                (win): Electron.MenuItemConstructorOptions => ({
                  label: windowDisplayLabel(win),
                  type: `checkbox`,
                  checked: win === focused,
                  click: () => {
                    if (win.isDestroyed()) return
                    if (win.isMinimized()) win.restore()
                    win.show()
                    win.focus()
                  },
                })
              ),
            ] as Array<Electron.MenuItemConstructorOptions>)
          : []),
      ],
    },
    {
      label: `Help`,
      submenu: [
        {
          label: `About ${APP_DISPLAY_NAME}`,
          click: () => showAboutDialog(),
        },
        { type: `separator` },
        {
          label: `Electric Documentation`,
          click: () => {
            void shell.openExternal(`https://electric-sql.com/docs/agents`)
          },
        },
        {
          label: `Electric on GitHub`,
          click: () => {
            void shell.openExternal(`https://github.com/electric-sql/electric`)
          },
        },
        { type: `separator` },
        {
          label: `Report an Issue`,
          click: () => {
            void shell.openExternal(
              `https://github.com/electric-sql/electric/issues/new`
            )
          },
        },
      ],
    },
  ]
}

function buildApplicationMenu(): void {
  const template = buildApplicationMenuTemplate()

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function popupApplicationMenuSection(
  win: BrowserWindow,
  section: DesktopMenuSection,
  bounds: DesktopMenuPopupBounds,
  state: DesktopMenuState
): void {
  const item = buildApplicationMenuTemplate().find(
    (candidate) => candidate.label === section
  )
  if (!item || !Array.isArray(item.submenu)) return

  Menu.buildFromTemplate(applyDesktopMenuState(item.submenu, state)).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

function popupAppIconMenu(
  win: BrowserWindow,
  bounds: DesktopMenuPopupBounds
): void {
  Menu.buildFromTemplate([
    {
      label: `About ${APP_DISPLAY_NAME}`,
      click: () => showAboutDialog(),
    },
    {
      label: `Check for Updates…`,
      enabled: false,
    },
  ]).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

function applyDesktopMenuState(
  items: Array<Electron.MenuItemConstructorOptions>,
  state: DesktopMenuState
): Array<Electron.MenuItemConstructorOptions> {
  const enabledByLabel = new Map<string, boolean>([
    [`Close Tile`, state.canCloseTile],
    [`Find in Pane…`, state.hasActiveTile],
    [`Find Next`, state.hasActiveTile],
    [`Find Previous`, state.hasActiveTile],
    [`Split Right`, state.canSplitTile],
    [`Split Down`, state.canSplitTile],
    [`Cycle Tile`, state.canCycleTile],
  ])

  return items.map((item) => {
    const next = { ...item }
    if (typeof item.label === `string` && enabledByLabel.has(item.label)) {
      next.enabled = enabledByLabel.get(item.label)
    }
    if (Array.isArray(item.submenu)) {
      next.submenu = applyDesktopMenuState(item.submenu, state)
    }
    return next
  })
}

async function main(): Promise<void> {
  // Make sure macOS shows the product name everywhere (about menu,
  // dock tooltip, default window title) instead of the npm package id.
  app.setName(APP_DISPLAY_NAME)

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on(`second-instance`, () => {
    showOrCreateWindow()
  })

  app.on(`window-all-closed`, () => {
    // Keep the tray/menu bar runtime alive until the user explicitly quits.
  })

  app.on(`activate`, () => {
    showOrCreateWindow()
  })

  // Re-render the menu when focus changes so the Window submenu's
  // checkmark moves to the now-focused window.
  app.on(`browser-window-focus`, () => buildApplicationMenu())
  app.on(`browser-window-blur`, () => buildApplicationMenu())

  app.on(`before-quit`, (event) => {
    if (isQuitting) return
    event.preventDefault()
    void quitApp()
  })

  await app.whenReady()
  configureRuntimeEnvironment()
  await loadSettings()
  registerIpcHandlers()
  await getCloudAuth().initialize()
  // Hydrate the per-tenant agents-token cache from `SecretStore`
  // BEFORE we install the webRequest hook so a window opening
  // straight onto a saved cloud server gets the auth headers added.
  const cloudTenantIds = settings.servers
    .filter((s) => s.source === `electric-cloud` && s.tenantId)
    .map((s) => s.tenantId as string)
  await getCloudAgentServers().hydrateTokens(cloudTenantIds)
  installCloudAuthHeaderInjection()
  // Eagerly kick the cloud-agent-servers streams once on boot — the
  // CloudAuth subscriber handles subsequent sign-in/sign-out edges.
  // Safe to call when signed-out: `start()` no-ops without a token.
  void getCloudAgentServers().start()
  nativeTheme.on(`updated`, refreshNativeTitleBars)

  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion() || `dev`,
    version: app.getVersion() || `dev`,
    copyright: `© ${new Date().getFullYear()} Electric DB Limited`,
    website: `https://electric.ax/agents`,
    // `iconPath` only affects Linux/Windows. macOS shows the app
    // bundle icon, which during dev is the Electron atom — we surface
    // the proper Electric mark via the custom About window instead.
    iconPath: APP_ICON_PATH,
    credits: `The durable runtime for long-lived agents.`,
  })

  // Dock icon on macOS — replaces the default Electron icon during
  // `electron .` dev. (Linux/Windows package icons are wired via the
  // builder config when we add packaging.)
  if (process.platform === `darwin` && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(APP_ICON_PATH)
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    } catch {
      // Non-fatal — dev still works with the default Electron icon.
    }
  }

  const trayIcon = createTrayIcon()
  if (trayIcon.isEmpty()) {
    console.error(
      `[agents-desktop] Tray icon failed to load from ${TRAY_ICON_PATH}; ` +
        `the menu bar item may be invisible.`
    )
  }
  tray = new Tray(trayIcon)
  tray.on(`click`, () => showOrCreateWindow())
  updateTray()

  buildApplicationMenu()

  createWindow()
  for (const server of settings.servers) {
    if (server.desiredState === `connected`) {
      void connectServer(server.id)
    }
  }
  startDiscoveryLoop()
}

void main()
