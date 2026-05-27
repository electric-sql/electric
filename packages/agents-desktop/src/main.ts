import { SecretStore } from './secret-store'
import {
  buildSavedServerHeaders,
  installCloudAuthHeaderInjection as installCloudAuthHeaderInjectionForDeps,
  type CloudAuthHeaderInjectionDeps,
} from './cloud/auth-injection'
import {
  desktopServerFetch as desktopServerFetchForDeps,
  type DesktopServerFetchDeps,
} from './cloud/server-fetch'
import {
  applyApiKeysToEnv,
  captureEnvApiKeys,
  EMPTY_API_KEYS,
  loadApiKeysFromSecret,
  normalizeApiKeys,
  saveApiKeysToSecret,
} from './credentials/api-keys'
import {
  checkAgentsServerHealth,
  formatStartupNetworkError,
} from './runtime/health'
import {
  createConnectionState,
  ensureRuntimeEntry as ensureRuntimeEntryInStore,
  runtimeStatusForConnection,
} from './runtime/entries'
import {
  broadcastMcpSnapshot as broadcastMcpSnapshotForDeps,
  EMPTY_MCP_SNAPSHOT,
  handleAuthorizeUrl as handleAuthorizeMcpUrl,
} from './runtime/mcp'
import {
  normalizeServer,
  normalizeServers,
  serverInList,
} from './settings/servers'
import {
  DEFAULT_SETTINGS,
  GLOBAL_API_KEYS_REF,
  normalizeCodexSettings,
  normalizeMcp,
  serializeSettings,
  SETTINGS_VERSION,
} from './settings/store'
import {
  hasHeader,
  injectDevPrincipalHeaders as injectDevPrincipalHeadersForServer,
  mergeHeaders,
  runnerOwnerPrincipalFromHeaders,
  runnerOwnerPrincipalFromUserId,
} from './shared/headers'
import type {
  ApiKeys,
  ApiKeysStatus,
  CodexAuthSource,
  CodexDetectedSource,
  CodexStatus,
  ConnectServerOptions,
  DesktopAppearance,
  DesktopCommand,
  DesktopContextMenuRequest,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopNavigationState,
  DesktopSettings,
  DesktopState,
  DiscoveredServer,
  LocalRuntimeStatus,
  OnboardingState,
  RegistrySnapshot,
  RuntimeEntry,
  ServerConfig,
  ServerConnectionStatus,
} from './shared/types'
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
import fixPath from 'fix-path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type StoredCodexAuth = {
  source: CodexAuthSource
  access: string | null
  refresh: string | null
  expiresAt: number | null
  accountId: string | null
  email: string | null
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
const IGNORE_CONNECTION_LIMIT_DOMAINS = `localhost,127.0.0.1`
const CODEX_AUTH_REF = `codex-auth:desktop`
const CODEX_OAUTH_CLIENT_ID = `app_EMoamEEZ73f0CkXaXp7hrann`
const CODEX_OAUTH_ISSUER = `https://auth.openai.com`
const CODEX_OAUTH_PORT = 1455
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000
const DESKTOP_USER_DATA_DIR =
  process.env.ELECTRIC_DESKTOP_USER_DATA_DIR?.trim() || null
const INITIAL_SERVER_URL =
  process.env.ELECTRIC_DESKTOP_SERVER_URL?.trim() ||
  process.env.ELECTRIC_AGENTS_SERVER_URL?.trim() ||
  null

// GUI-launched desktop apps don't inherit the user's shell PATH — restore it
// so child processes can find CLI tools like `gh`.
fixPath()

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
// local agents server. Electron supports bypassing Chromium's connection cap
// for a domain list; this must run before Electron creates its network context.
app.commandLine.appendSwitch(
  `ignore-connections-limit`,
  IGNORE_CONNECTION_LIMIT_DOMAINS
)
console.info(
  `[agents-desktop] ignore-connections-limit=${app.commandLine.getSwitchValue(
    `ignore-connections-limit`
  )}`
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
const PULL_WAKE_OWNER_PRINCIPAL =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_OWNER_PRINCIPAL?.trim() ||
  `/principal/system%3Adev-local`
const DEFAULT_LOCAL_DEV_PRINCIPAL = `system:dev-local`
const EXPLICIT_DEV_PRINCIPAL = ((): string | null => {
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

const EXTERNAL_LINK_PROTOCOLS = new Set([`http:`, `https:`, `mailto:`])

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
  ...captureEnvApiKeys(process.env),
}

let settings: DesktopSettings = { ...DEFAULT_SETTINGS }
let apiKeys: ApiKeys = { ...EMPTY_API_KEYS }
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
  credentialsRestartPending: false,
}
let credentialsRestartPending = false
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
  // Desktop owns Codex consent. The runtime must not implicitly read
  // ~/.codex/auth.json just because it exists.
  process.env.ELECTRIC_CODEX_REQUIRE_OPT_IN = `1`
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

const cloudAuthHeaderInjectionDeps: CloudAuthHeaderInjectionDeps = {
  getServers: () => settings.servers,
  getAgentsToken: (tenantId) => cloudAgentServers?.getAgentsToken(tenantId),
  getCloudAuthState: () => cloudAuth?.getState(),
  injectDevPrincipalHeaders,
}

const desktopServerFetchDeps: DesktopServerFetchDeps = {
  getServers: () => settings.servers,
  buildSavedServerHeaders: (url) =>
    buildSavedServerHeaders(cloudAuthHeaderInjectionDeps, url),
}

function installCloudAuthHeaderInjection(): void {
  installCloudAuthHeaderInjectionForDeps(cloudAuthHeaderInjectionDeps)
}

async function desktopServerFetch(request: unknown) {
  return desktopServerFetchForDeps(desktopServerFetchDeps, request)
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

function codexEmptyStatus(error: string | null = null): CodexStatus {
  const codex = settings.codex ?? { enabled: false, source: null }
  return {
    enabled: codex.enabled,
    source: codex.source,
    availableSources: [],
    accountId: null,
    email: null,
    expiresAt: null,
    error,
  }
}

async function readJson(pathName: string): Promise<unknown> {
  return JSON.parse(await readFile(pathName, `utf8`)) as unknown
}

function pickString(value: unknown): string | null {
  return typeof value === `string` && value.trim().length > 0
    ? value.trim()
    : null
}

function parseJwtClaims(token: string | null): Record<string, unknown> | null {
  if (!token) return null
  const parts = token.split(`.`)
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, `base64url`).toString()) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

function codexAccountIdFromClaims(
  claims: Record<string, unknown> | null
): string | null {
  if (!claims) return null
  const nested =
    claims[`https://api.openai.com/auth`] &&
    typeof claims[`https://api.openai.com/auth`] === `object`
      ? (claims[`https://api.openai.com/auth`] as Record<string, unknown>)
      : null
  const organizations = Array.isArray(claims.organizations)
    ? claims.organizations
    : []
  const organization = organizations.find((entry): entry is { id: string } =>
    Boolean(
      entry &&
        typeof entry === `object` &&
        typeof (entry as { id?: unknown }).id === `string`
    )
  )
  return (
    pickString(claims.chatgpt_account_id) ??
    pickString(nested?.chatgpt_account_id) ??
    organization?.id ??
    null
  )
}

function codexAuthFromTokenResponse(
  source: CodexAuthSource,
  tokens: {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    id_token?: unknown
  },
  fallback?: Partial<StoredCodexAuth>
): StoredCodexAuth | null {
  const access = pickString(tokens.access_token) ?? fallback?.access ?? null
  const refresh = pickString(tokens.refresh_token) ?? fallback?.refresh ?? null
  if (!access && !refresh) return null
  const idClaims = parseJwtClaims(pickString(tokens.id_token))
  const accessClaims = parseJwtClaims(access)
  const email = pickString(idClaims?.email) ?? fallback?.email ?? null
  const accountId =
    codexAccountIdFromClaims(idClaims) ??
    codexAccountIdFromClaims(accessClaims) ??
    fallback?.accountId ??
    null
  const expiresIn =
    typeof tokens.expires_in === `number`
      ? tokens.expires_in
      : Number(tokens.expires_in)
  return {
    source,
    access,
    refresh,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : (fallback?.expiresAt ?? null),
    accountId,
    email,
  }
}

function codexCliAuthPath(): string {
  return (
    process.env.CODEX_AUTH_PATH?.trim() ||
    path.join(app.getPath(`home`), `.codex`, `auth.json`)
  )
}

function opencodeAuthPaths(): Array<string> {
  const home = app.getPath(`home`)
  const paths = [path.join(home, `.local`, `share`, `opencode`, `auth.json`)]
  if (process.platform === `darwin`) {
    paths.push(
      path.join(home, `Library`, `Application Support`, `opencode`, `auth.json`)
    )
  }
  return paths
}

function parseCodexCliAuth(value: unknown): StoredCodexAuth | null {
  if (!value || typeof value !== `object`) return null
  const data = value as Record<string, unknown>
  if (data.auth_mode !== `chatgpt`) return null
  const tokens =
    data.tokens && typeof data.tokens === `object`
      ? (data.tokens as Record<string, unknown>)
      : {}
  return codexAuthFromTokenResponse(`codex-cli`, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    expires_in: tokens.expires_in,
  })
}

function parseOpencodeAuth(value: unknown): StoredCodexAuth | null {
  if (!value || typeof value !== `object`) return null
  const openai = (value as Record<string, unknown>).openai
  if (!openai || typeof openai !== `object`) return null
  const data = openai as Record<string, unknown>
  if (data.type !== `oauth`) return null
  const access = pickString(data.access)
  const refresh = pickString(data.refresh)
  if (!access && !refresh) return null
  return {
    source: `opencode`,
    access,
    refresh,
    expiresAt:
      typeof data.expires === `number` && Number.isFinite(data.expires)
        ? data.expires
        : null,
    accountId: pickString(data.accountId),
    email: null,
  }
}

async function loadDetectedCodexAuth(
  source: CodexAuthSource
): Promise<StoredCodexAuth | null> {
  if (source === `desktop-oauth`) return loadStoredCodexAuth()
  if (source === `codex-cli`) {
    try {
      return parseCodexCliAuth(await readJson(codexCliAuthPath()))
    } catch {
      return null
    }
  }
  for (const candidate of opencodeAuthPaths()) {
    try {
      const auth = parseOpencodeAuth(await readJson(candidate))
      if (auth) return auth
    } catch {
      // Try the next platform path.
    }
  }
  return null
}

async function loadStoredCodexAuth(): Promise<StoredCodexAuth | null> {
  const raw = await getSecretStore().get(CODEX_AUTH_REF)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCodexAuth>
    const source = normalizeCodexSettings({
      enabled: true,
      source: parsed.source,
    }).source
    if (!source) return null
    return {
      source,
      access: pickString(parsed.access),
      refresh: pickString(parsed.refresh),
      expiresAt:
        typeof parsed.expiresAt === `number` &&
        Number.isFinite(parsed.expiresAt)
          ? parsed.expiresAt
          : null,
      accountId: pickString(parsed.accountId),
      email: pickString(parsed.email),
    }
  } catch {
    return null
  }
}

async function saveStoredCodexAuth(auth: StoredCodexAuth): Promise<void> {
  await getSecretStore().set(CODEX_AUTH_REF, JSON.stringify(auth))
}

async function refreshCodexAuthIfNeeded(
  auth: StoredCodexAuth
): Promise<StoredCodexAuth | null> {
  if (!auth.refresh) return auth.access ? auth : null
  if (auth.access && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
    return auth
  }
  const res = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: `POST`,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
    body: new URLSearchParams({
      grant_type: `refresh_token`,
      refresh_token: auth.refresh,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) return null
  const next = codexAuthFromTokenResponse(
    auth.source,
    (await res.json()) as Record<string, unknown>,
    auth
  )
  if (next) await saveStoredCodexAuth(next)
  return next
}

async function syncCodexEnvironment(): Promise<void> {
  process.env.ELECTRIC_CODEX_REQUIRE_OPT_IN = `1`
  delete process.env.ELECTRIC_CODEX_ACCESS_TOKEN
  const codex = settings.codex ?? { enabled: false, source: null }
  if (!codex.enabled || !codex.source) return
  const stored = await loadStoredCodexAuth()
  if (!stored) return
  const refreshed = await refreshCodexAuthIfNeeded(stored)
  if (refreshed?.access) {
    process.env.ELECTRIC_CODEX_ACCESS_TOKEN = refreshed.access
  }
}

async function detectCodexSources(): Promise<Array<CodexDetectedSource>> {
  const sources: Array<CodexDetectedSource> = []
  const stored = await loadStoredCodexAuth()
  if (stored?.access || stored?.refresh) {
    sources.push({
      source: `desktop-oauth`,
      label: `Electric Agents ChatGPT / Codex sign-in`,
      accountId: stored.accountId,
      email: stored.email,
      expiresAt: stored.expiresAt,
    })
  }
  const cli = await loadDetectedCodexAuth(`codex-cli`)
  if (cli?.access || cli?.refresh) {
    sources.push({
      source: `codex-cli`,
      label: `ChatGPT / Codex CLI login`,
      accountId: cli.accountId,
      email: cli.email,
      expiresAt: cli.expiresAt,
    })
  }
  const opencode = await loadDetectedCodexAuth(`opencode`)
  if (opencode?.access || opencode?.refresh) {
    sources.push({
      source: `opencode`,
      label: `OpenCode ChatGPT / Codex login`,
      accountId: opencode.accountId,
      email: opencode.email,
      expiresAt: opencode.expiresAt,
    })
  }
  return sources
}

async function getCodexStatus(): Promise<CodexStatus> {
  try {
    const availableSources = await detectCodexSources()
    const stored = await loadStoredCodexAuth()
    const codex = settings.codex ?? { enabled: false, source: null }
    return {
      enabled: codex.enabled && Boolean(stored),
      source: codex.enabled && stored ? codex.source : null,
      availableSources,
      accountId: stored?.accountId ?? null,
      email: stored?.email ?? null,
      expiresAt: stored?.expiresAt ?? null,
      error: null,
    }
  } catch (error) {
    return codexEmptyStatus(
      error instanceof Error ? error.message : String(error)
    )
  }
}

async function restartConnectedRuntimes(): Promise<void> {
  await Promise.all(
    settings.servers
      .filter((server) => server.desiredState === `connected`)
      .map((server) => restartRuntime(server.id))
  )
  // Any in-flight credential change has now been applied to the
  // freshly-started runtime processes — clear the banner.
  setCredentialsRestartPending(false)
}

/**
 * `true` when at least one server is configured for a local runtime
 * and currently held in the `connected` desired state. Mirrors the
 * filter used by `restartConnectedRuntimes()` so the renderer's
 * "Restart local runtime to apply changes" banner is surfaced iff
 * clicking the restart button would actually do something. Includes
 * runtimes in `running`, `starting`, and `error` states — any active
 * connected runtime whose env-var snapshot could now be stale.
 */
function hasConnectedLocalRuntime(): boolean {
  return settings.servers.some(
    (server) =>
      server.localRuntimeEnabled && server.desiredState === `connected`
  )
}

/**
 * Called from every credential-mutation path (API keys, Codex
 * sign-in/out, source switch). Flags that the running local runtime
 * is now stale relative to the saved credentials, so the renderer
 * can surface the restart banner. No-op when nothing is connected
 * (the next start will pick up the new env automatically).
 */
function markCredentialsDirty(): void {
  if (!hasConnectedLocalRuntime()) return
  setCredentialsRestartPending(true)
}

function setCredentialsRestartPending(value: boolean): void {
  if (credentialsRestartPending === value) return
  credentialsRestartPending = value
  refreshDesktopState()
}

async function enableCodexSource(
  source: CodexAuthSource
): Promise<CodexStatus> {
  const auth = await loadDetectedCodexAuth(source)
  if (!auth) {
    throw new Error(`No ${source} Codex login was found.`)
  }
  const refreshed = await refreshCodexAuthIfNeeded(auth)
  await saveStoredCodexAuth(refreshed ?? auth)
  settings.codex = { enabled: true, source }
  await saveSettings()
  await syncCodexEnvironment()
  markCredentialsDirty()
  return getCodexStatus()
}

async function disableCodex(): Promise<CodexStatus> {
  settings.codex = { enabled: false, source: null }
  await getSecretStore().delete(CODEX_AUTH_REF)
  await saveSettings()
  await syncCodexEnvironment()
  markCredentialsDirty()
  return getCodexStatus()
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString(`base64`)
    .replace(/\+/g, `-`)
    .replace(/\//g, `_`)
    .replace(/=+$/, ``)
}

/**
 * HTML for the small Electron window we show *while* the user
 * completes the Codex OAuth flow in their default browser. Spinner +
 * one-line explanation + a Cancel button (which just calls
 * `window.close()` — the BrowserWindow's `closed` listener does the
 * actual cancellation work).
 *
 * Inlined as a `data:` URL so we don't need a separate asset file or
 * a preload script — the page only needs `window.close()`, which
 * Electron allows for windows it created.
 */
function codexSignInWaitingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign in to ChatGPT / Codex</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
    margin: 0;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 100vh;
    box-sizing: border-box;
    -webkit-user-select: none;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0; }
  p { margin: 0; line-height: 1.5; color: GrayText; font-size: 13px; }
  .spinner {
    width: 24px; height: 24px;
    border-radius: 50%;
    border: 3px solid color-mix(in oklab, CanvasText 12%, Canvas);
    border-top-color: color-mix(in oklab, CanvasText 70%, Canvas);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .actions { margin-top: auto; display: flex; justify-content: flex-end; }
  button {
    font: inherit; font-weight: 500;
    padding: 6px 14px; border-radius: 6px;
    border: 1px solid color-mix(in oklab, CanvasText 18%, Canvas);
    background: Canvas; color: CanvasText;
    cursor: pointer;
  }
  button:hover { background: color-mix(in oklab, CanvasText 6%, Canvas); }
</style>
</head>
<body>
  <div class="spinner" aria-hidden="true"></div>
  <h1>Waiting for sign-in…</h1>
  <p>We've opened the OpenAI sign-in page in your default browser. After you finish there, this window will close automatically.</p>
  <div class="actions">
    <button type="button" onclick="window.close()">Cancel</button>
  </div>
</body>
</html>`
}

/**
 * HTML page returned to the user's default browser by our loopback
 * OAuth listener after a successful sign-in. The user is *in their
 * real browser*, not Electron, so we can't reliably auto-close the
 * tab — we just show a friendly "you can close this" message and
 * trust the Electron app to take focus on its own once the auth
 * window closes.
 */
function codexSignInSuccessHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in to ChatGPT / Codex</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    box-sizing: border-box;
  }
  .card {
    max-width: 420px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  p { margin: 0; line-height: 1.5; color: GrayText; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>You're signed in</h1>
    <p>You can close this tab and return to Electric Agents.</p>
  </div>
</body>
</html>`
}

async function signInCodex(): Promise<CodexStatus | null> {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash(`sha256`).update(verifier).digest())
  const state = base64Url(randomBytes(32))
  const redirectUri = `http://localhost:${CODEX_OAUTH_PORT}/auth/callback`
  const authorizeUrl = `${CODEX_OAUTH_ISSUER}/oauth/authorize?${new URLSearchParams(
    {
      response_type: `code`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: `openid profile email offline_access`,
      code_challenge: challenge,
      code_challenge_method: `S256`,
      id_token_add_organizations: `true`,
      codex_cli_simplified_flow: `true`,
      state,
      originator: `electric-agents`,
    }
  ).toString()}`

  const serverRef: { current: HttpServer | null } = { current: null }
  const winRef: { current: BrowserWindow | null } = { current: null }
  // Outcomes:
  //   `string` — authorization code returned by the OAuth callback.
  //   `null`   — user cancelled (closed the OAuth window).
  // Anything else (timeout, server error, OAuth error response) still
  // throws so the renderer can surface a real failure.
  try {
    const code = await new Promise<string | null>((resolve, reject) => {
      let done = false
      const timeout = setTimeout(() => {
        reject(new Error(`Codex sign-in timed out.`))
      }, 5 * 60_000)
      const settle = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(timeout)
        fn()
      }
      serverRef.current = createServer((req, res) => {
        const url = new URL(req.url ?? `/`, redirectUri)
        if (url.pathname !== `/auth/callback`) {
          res.writeHead(404)
          res.end(`Not found`)
          return
        }
        const error =
          url.searchParams.get(`error_description`) ??
          url.searchParams.get(`error`)
        const returnedState = url.searchParams.get(`state`)
        const returnedCode = url.searchParams.get(`code`)
        if (error || returnedState !== state || !returnedCode) {
          res.writeHead(400, { 'Content-Type': `text/html` })
          res.end(`<html><body>Codex authorization failed.</body></html>`)
          settle(() =>
            reject(new Error(error ?? `Invalid Codex OAuth callback.`))
          )
          return
        }
        res.writeHead(200, { 'Content-Type': `text/html; charset=utf-8` })
        res.end(codexSignInSuccessHtml())
        settle(() => resolve(returnedCode))
      })
      serverRef.current.listen(CODEX_OAUTH_PORT, `localhost`, () => {
        // Embedding `auth.openai.com` inside an Electron BrowserWindow
        // trips Cloudflare's bot fingerprinting (UA, JA3, navigator
        // quirks) and the user gets stuck in a "Verify you are human"
        // loop that never resolves. Hand the OAuth flow off to the
        // user's *default* browser instead — that browser passes
        // Cloudflare normally, and our loopback HTTP listener still
        // captures the redirect because the redirect URI is
        // `http://localhost:CODEX_OAUTH_PORT/auth/callback`.
        //
        // The Electron window is now just a small "Sign-in opened in
        // your browser…" affordance with a spinner + Cancel button so
        // the user has visible feedback that something is happening
        // and a way to bail out without waiting for the timeout.
        winRef.current = new BrowserWindow({
          title: `Sign in to ChatGPT / Codex`,
          width: 460,
          height: 280,
          resizable: false,
          minimizable: false,
          maximizable: false,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        })
        winRef.current.on(`closed`, () => {
          winRef.current = null
          // User dismissed the waiting window — treat as a quiet
          // cancel so the renderer doesn't surface a scary error
          // message. (If the OAuth callback already fired, `settle`
          // is a no-op here.)
          settle(() => resolve(null))
        })
        void winRef.current.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(
            codexSignInWaitingHtml()
          )}`
        )
        void shell.openExternal(authorizeUrl).catch((err) => {
          settle(() =>
            reject(
              err instanceof Error
                ? err
                : new Error(`Could not open browser for Codex sign-in.`)
            )
          )
        })
      })
      serverRef.current.on(`error`, (error) => {
        settle(() => reject(error))
      })
    })

    if (code === null) return null

    const res = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
      method: `POST`,
      headers: { 'Content-Type': `application/x-www-form-urlencoded` },
      body: new URLSearchParams({
        grant_type: `authorization_code`,
        code,
        redirect_uri: redirectUri,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Codex token exchange failed: ${res.status}`)
    const auth = codexAuthFromTokenResponse(
      `desktop-oauth`,
      (await res.json()) as Record<string, unknown>
    )
    if (!auth) throw new Error(`Codex sign-in did not return usable tokens.`)
    await saveStoredCodexAuth(auth)
    settings.codex = { enabled: true, source: `desktop-oauth` }
    await saveSettings()
    await syncCodexEnvironment()
    markCredentialsDirty()
    return getCodexStatus()
  } finally {
    const currentWin = winRef.current
    const currentServer = serverRef.current
    if (currentWin && !currentWin.isDestroyed()) currentWin.close()
    if (currentServer) {
      try {
        currentServer.close()
      } catch {
        // The server may have failed before it started listening.
      }
    }
  }
}

// settings.json's `mcp.servers` mirrors the shape of `mcp.json`: an
// object keyed by server name, with the entry itself omitting `name`.
// We rewrite into the array form `BuiltinAgentsServer.extraMcpServers`
// expects and surface friendly warnings on shape errors instead of
// silently dropping the field. Schema-level validation (transport /
// auth.mode / forbidden refs) still happens inside the registry's
// `applyConfig`.
function applyApiKeys(): void {
  applyApiKeysToEnv(apiKeys, ENV_API_KEYS_SNAPSHOT, process.env)
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
      codex: normalizeCodexSettings(parsed.codex),
      mcp: normalizeMcp(parsed.mcp),
      pullWakeRunnerId,
    }
    if (parsed.apiKeys !== undefined) {
      apiKeys = normalizeApiKeys(parsed.apiKeys)
      await saveApiKeysToSecret(getSecretStore(), apiKeysRef, apiKeys)
      shouldSave = true
    } else {
      apiKeys = await loadApiKeysFromSecret(getSecretStore(), apiKeysRef)
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
    apiKeys = await loadApiKeysFromSecret(getSecretStore(), settings.apiKeysRef)
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
  await syncCodexEnvironment()
  if (shouldSave) {
    await saveSettings()
  }
}

async function saveSettings(): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(
    settingsPath(),
    JSON.stringify(serializeSettings(settings), null, 2)
  )
}

function ensureRuntimeEntry(server: ServerConfig): RuntimeEntry {
  return ensureRuntimeEntryInStore(runtimeEntries, server)
}

function selectedServerIdForWindow(win: BrowserWindow | null): string | null {
  if (win && !win.isDestroyed()) {
    const existing = windowSelections.get(win.id)
    if (existing && findServer(existing)) return existing
  }
  return defaultSelectedServerId()
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
  return injectDevPrincipalHeadersForServer(server, {
    explicitDevPrincipal: EXPLICIT_DEV_PRINCIPAL,
    defaultLocalDevPrincipal: DEFAULT_LOCAL_DEV_PRINCIPAL,
  })
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
    // Only expose the pending state when there's actually a connected
    // local runtime to restart; otherwise the banner would prompt for
    // an action that wouldn't do anything.
    credentialsRestartPending:
      credentialsRestartPending && hasConnectedLocalRuntime(),
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

function broadcastMcpSnapshot(
  serverId: string,
  snapshot: RegistrySnapshot
): void {
  broadcastMcpSnapshotForDeps(
    { snapshots: lastMcpSnapshots, windows },
    serverId,
    snapshot
  )
}

async function handleAuthorizeUrl(
  serverId: string,
  url: string,
  server: string
): Promise<void> {
  await handleAuthorizeMcpUrl({
    runtimeEntries,
    redirectBase: MCP_OAUTH_REDIRECT_BASE,
    serverId,
    url,
    server,
  })
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
  broadcastMcpSnapshot(entry.serverId, EMPTY_MCP_SNAPSHOT)
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
  // headers (injected by the undici / webRequest hooks). Register the
  // runner under that user principal instead of the dev-local
  // fallback used for unauthenticated local servers.
  const cloudAuthUserId =
    activeServer.source === `electric-cloud`
      ? (cloudAuth?.getState().userId ?? null)
      : null
  const runnerOwnerPrincipal =
    runnerOwnerPrincipalFromUserId(cloudAuthUserId) ??
    runnerOwnerPrincipalFromHeaders(runtimeHeaders, PULL_WAKE_OWNER_PRINCIPAL)
  console.info(
    `[agents-desktop] Starting built-in agents runtime for server ${activeServer.url}`
  )
  console.info(`[agents-desktop] Pull-wake runner id: ${runnerId}`)
  if (PULL_WAKE_REGISTER_RUNNER) {
    console.info(
      `[agents-desktop] Pull-wake runner registration enabled; owner principal: ${runnerOwnerPrincipal ?? `(derived from auth)`}`
    )
  } else {
    console.info(
      `[agents-desktop] Pull-wake runner registration skipped; runner must already be registered with the agents server.`
    )
  }

  configureRuntimeEnvironment()
  applyApiKeys()
  await syncCodexEnvironment()
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
      ownerPrincipal: PULL_WAKE_REGISTER_RUNNER
        ? runnerOwnerPrincipal
        : undefined,
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

async function connectServer(
  serverId: string,
  options: ConnectServerOptions = {}
): Promise<void> {
  const server = findServer(serverId)
  if (!server) return
  if (typeof options.localRuntimeEnabled === `boolean`) {
    server.localRuntimeEnabled = options.localRuntimeEnabled
  }
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

async function forgetServer(serverId: string): Promise<void> {
  const server = findServer(serverId)
  if (!server) return
  await disconnectServer(serverId)
  settings.servers = settings.servers.filter((entry) => entry.id !== serverId)
  runtimeEntries.delete(serverId)
  if (server.tenantId) {
    await getCloudAgentServers().forgetAgentsToken(server.tenantId)
  }
  if (settings.defaultServerId === serverId) {
    settings.defaultServerId = settings.servers[0]?.id ?? null
  }
  for (const [windowId, selectedServerId] of windowSelections) {
    if (selectedServerId === serverId) {
      windowSelections.set(windowId, settings.defaultServerId)
    }
  }
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
  // Once at least one local runtime has been (re)started, the
  // current env-var snapshot is in sync with saved credentials.
  // Clear globally rather than per-runtime — if the user has
  // multiple local runtimes, restarting one is enough of an
  // explicit intent that we drop the banner.
  if (server.localRuntimeEnabled) setCredentialsRestartPending(false)
}

async function stopRuntime(serverId?: string | null): Promise<void> {
  const id =
    serverId ??
    selectedServerIdForWindow(BrowserWindow.getFocusedWindow()) ??
    settings.defaultServerId
  if (!id) return
  await disconnectServer(id)
}

async function getApiKeysStatus(): Promise<ApiKeysStatus> {
  const saved = apiKeys
  // Brave is optional (falls back to Anthropic built-in search), so
  // it doesn't count toward "the app is configured" — the dialog
  // only auto-opens when the user has no LLM provider key at all.
  const hasAnyKey = Boolean(saved.anthropic || saved.openai || saved.deepseek)
  // Only suggest env values for slots the user hasn't already saved
  // — once they've persisted a key for a provider, the dialog should
  // show their saved value rather than the (potentially different)
  // environment value.
  const suggested: ApiKeys = {
    anthropic: saved.anthropic ? null : ENV_API_KEYS_SNAPSHOT.anthropic,
    openai: saved.openai ? null : ENV_API_KEYS_SNAPSHOT.openai,
    deepseek: saved.deepseek ? null : ENV_API_KEYS_SNAPSHOT.deepseek,
    brave: saved.brave ? null : ENV_API_KEYS_SNAPSHOT.brave,
  }
  const codex = await getCodexStatus()
  return { hasAnyKey: hasAnyKey || codex.enabled, saved, suggested, codex }
}

async function setApiKeys(next: ApiKeys): Promise<void> {
  const normalized = normalizeApiKeys(next)
  const changed =
    normalized.anthropic !== apiKeys.anthropic ||
    normalized.openai !== apiKeys.openai ||
    normalized.deepseek !== apiKeys.deepseek ||
    normalized.brave !== apiKeys.brave
  apiKeys = normalized
  await saveApiKeysToSecret(getSecretStore(), settings.apiKeysRef, apiKeys)
  applyApiKeys()
  await saveSettings()
  if (changed) markCredentialsDirty()
}

function getOnboardingState(): OnboardingState {
  const cloudStatus = cloudAuth?.getState().status
  return {
    dismissed: settings.onboardingDismissed === true,
    hasAnyKey: Boolean(
      apiKeys.anthropic ||
        apiKeys.openai ||
        apiKeys.deepseek ||
        settings.codex?.enabled
    ),
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

async function clearAllLocalDataAndRelaunch(): Promise<void> {
  await getCloudAuth().signOut()
  await getCloudAgentServers().stop()
  await Promise.all([
    session.defaultSession.clearStorageData(),
    session.defaultSession.clearCache(),
    rm(settingsPath(), { force: true }),
    rm(secretsPath(), { force: true }),
  ])
  secretStore = null
  app.relaunch()
  await quitApp()
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
  ipcMain.handle(`desktop:server-fetch`, (_event, request: unknown) =>
    desktopServerFetch(request)
  )
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
  ipcMain.handle(
    `desktop:connect-server`,
    async (_event, serverId, options?: ConnectServerOptions) => {
      if (typeof serverId === `string`) await connectServer(serverId, options)
    }
  )
  ipcMain.handle(`desktop:disconnect-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await disconnectServer(serverId)
  })
  ipcMain.handle(`desktop:forget-server`, async (_event, serverId) => {
    if (typeof serverId === `string`) await forgetServer(serverId)
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
  ipcMain.handle(`desktop:codex-sign-in`, () => signInCodex())
  ipcMain.handle(
    `desktop:codex-enable-source`,
    (_event, source: CodexAuthSource) => enableCodexSource(source)
  )
  ipcMain.handle(`desktop:codex-disable`, () => disableCodex())
  ipcMain.handle(`desktop:restart-local-runtimes`, async () => {
    await restartConnectedRuntimes()
  })
  ipcMain.handle(`desktop:clear-all-local-data`, async () => {
    await clearAllLocalDataAndRelaunch()
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
  ipcMain.handle(`desktop:cloud-auth-open-create-agents-server`, () => {
    getCloudAuth().openCreateAgentsServer()
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
    return (id ? lastMcpSnapshots.get(id) : null) ?? EMPTY_MCP_SNAPSHOT
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
