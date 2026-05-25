import type { ServerConfig } from './types'

export type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`
export type LocalRuntimeStatus =
  | `disabled`
  | `stopped`
  | `starting`
  | `running`
  | `error`
export type ServerConnectionStatus =
  | `disconnected`
  | `connecting`
  | `connected`
  | `reconnecting`
  | `offline`
  | `error`

/**
 * An agents-server detected by the Electron main-process scan of
 * localhost (see `runDiscovery()` in `packages/agents-desktop/src/main.ts`).
 * The renderer surfaces these as one-click "add to saved servers"
 * suggestions in `ServerPicker`.
 */
export interface DiscoveredServer {
  url: string
  port: number
  /** Epoch ms — when the main process last saw a healthy probe. */
  lastSeen: number
}

export interface DesktopState {
  servers: Array<ServerConfig>
  selectedServerId: string | null
  connections: Array<ServerConnectionState>
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  discoveredServers: Array<DiscoveredServer>
  pullWakeRunnerId: string | null
}

export interface DesktopServerFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

export interface DesktopServerFetchResponse {
  url: string
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface ServerConnectionState {
  serverId: string
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtimeUrl: string | null
  runtimeError: string | null
  lastError: string | null
  reconnectAttempt: number
  lastConnectedAt: number | null
}

/**
 * Provider API keys round-tripped between the Electron main process
 * (where they're persisted in `settings.json` and mirrored into
 * `process.env` for Horton) and the renderer's first-launch dialog.
 * `null` means "not set". The renderer never reads these from
 * `process.env` directly — that only exists in main.
 *
 * - `anthropic` / `openai`: at least one is required for the local
 *   Horton runtime to be useful; the dialog auto-opens until one is
 *   set.
 * - `brave`: optional. Mirrored to `BRAVE_SEARCH_API_KEY` to enable
 *   Horton's `brave_search` tool; without it, web search falls back
 *   to Anthropic's built-in search.
 */
export interface ApiKeys {
  anthropic: string | null
  openai: string | null
  /**
   * Optional. When set, mirrors to `DEEPSEEK_API_KEY` so the runtime
   * can use DeepSeek models. Does not count toward "has any LLM key"
   * on its own (parallel to how `brave` is optional).
   */
  deepseek: string | null
  brave: string | null
}

export interface ApiKeysStatus {
  /** `true` when at least one provider key is already saved. */
  hasAnyKey: boolean
  saved: ApiKeys
  /**
   * Per-slot ENV-derived suggestions: a value is provided only for
   * slots that are NOT already saved, so the dialog can pre-fill
   * empty inputs from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` without
   * overwriting the user's saved choice.
   */
  suggested: ApiKeys
}

/**
 * Snapshot consumed by the renderer's onboarding wizard.
 *
 * - `dismissed`: persisted "Don't show again" flag — once set the
 *   wizard never reopens automatically (Settings remains available).
 * - `hasAnyKey`: at least one LLM provider key already saved.
 * - `signedIn`: Electric Cloud session restored on launch.
 *
 * The renderer decides whether to render the modal based on these
 * three bits; main process doesn't make the policy call.
 */
export interface OnboardingState {
  dismissed: boolean
  hasAnyKey: boolean
  signedIn: boolean
}

/**
 * Commands fired from the Electron application menu / tray over the
 * `desktop:command` IPC channel. The renderer's command handler (see
 * `RootShell` in `router.tsx`) maps each one to the same UI action a
 * button or hotkey would trigger, so menu / button / keyboard channels
 * all stay in lockstep.
 */
export type DesktopCommand =
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

export type DesktopMenuSection = `File` | `Edit` | `View` | `Window` | `Help`

export type DesktopMenuPopupBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopMenuState = {
  hasActiveTile: boolean
  canCloseTile: boolean
  canSplitTile: boolean
  canCycleTile: boolean
}

export type DesktopNavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

export type DesktopAppearance = `light` | `dark` | `system`

/**
 * Electric Cloud account state mirrored from the Electron main process.
 *
 * - `signed-out`: no stored JWT, or the stored token was expired at
 *   launch and discarded.
 * - `signing-in`: an OAuth BrowserWindow is open and waiting on the
 *   user to complete the GitHub/Google flow.
 * - `signed-in`: a non-expired JWT is held in encrypted storage; the
 *   email/expiresAt fields are the values returned from the admin-API
 *   callback redirect.
 * - `error`: the most recent sign-in attempt failed; `error` carries
 *   the message. The previous `signed-in` state is restored on next
 *   attempt or app launch (we only flip back to `error` for the
 *   in-progress attempt, not the persisted session).
 */
export type CloudAuthProvider = `github` | `google`
export type CloudAuthStatus =
  | `signed-out`
  | `signing-in`
  | `signed-in`
  | `error`
export interface CloudAuthWorkspace {
  id: string
  name: string
}
export interface CloudAuthState {
  status: CloudAuthStatus
  email: string | null
  name: string | null
  userId: string | null
  workspaces: ReadonlyArray<CloudAuthWorkspace> | null
  error: string | null
}

/**
 * Continuously-synced view of the user's Electric Cloud agent servers,
 * joined client-side (in the main process) with the user's workspaces,
 * projects, and environments so each row carries the labels the UI
 * needs to render "Agent X — Workspace / Project / Environment".
 *
 * - `idle`: no auth yet (signed-out) or no streams subscribed.
 * - `loading`: streams just started; rows still empty.
 * - `ready`: streams have produced at least one snapshot; `servers`
 *   reflects the latest join. Rows mutate live as the underlying
 *   shapes change — UI should re-render off `onStateChanged`.
 * - `unauthorized`: a 401/403 on one of the streams. Streams are
 *   stopped; caller should expect to sign back in.
 * - `error`: transient — previous `servers` snapshot is retained.
 */
export type CloudAgentServersStatus =
  | `idle`
  | `loading`
  | `ready`
  | `unauthorized`
  | `error`

export interface CloudAgentServer {
  /** stream_services.id — also the tenant identifier in the cloud agents server. */
  id: string
  name: string
  workspaceId: string | null
  workspaceName: string | null
  projectId: string | null
  projectName: string | null
  environmentId: string | null
  environmentName: string | null
  updatedAt: string | null
}

export interface CloudAgentServersState {
  status: CloudAgentServersStatus
  servers: ReadonlyArray<CloudAgentServer>
  error: string | null
}

declare global {
  interface Window {
    electronAPI?: {
      getServers: () => Promise<Array<ServerConfig>>
      saveServers: (servers: Array<ServerConfig>) => Promise<void>
      getDesktopState?: () => Promise<DesktopState>
      serverFetch?: (
        request: DesktopServerFetchRequest
      ) => Promise<DesktopServerFetchResponse>
      setNativeAppearance?: (appearance: DesktopAppearance) => Promise<void>
      setActiveServer?: (server: ServerConfig | null) => Promise<void>
      setSelectedServer?: (serverId: string | null) => Promise<void>
      connectServer?: (serverId: string) => Promise<void>
      disconnectServer?: (serverId: string) => Promise<void>
      restartRuntime?: () => Promise<void>
      restartServerRuntime?: (serverId: string) => Promise<void>
      stopRuntime?: () => Promise<void>
      stopServerRuntime?: (serverId: string) => Promise<void>
      rescanServers?: () => Promise<Array<DiscoveredServer>>
      getApiKeysStatus?: () => Promise<ApiKeysStatus>
      saveApiKeys?: (keys: ApiKeys) => Promise<void>
      getOnboardingState?: () => Promise<OnboardingState>
      setOnboardingDismissed?: (dismissed: boolean) => Promise<void>
      getWorkingDirectory?: () => Promise<string | null>
      chooseWorkingDirectory?: () => Promise<string | null>
      /**
       * One-shot native folder picker. Unlike `chooseWorkingDirectory`,
       * this does NOT update the runtime's persistent working dir or
       * restart the runtime — used by the new-session screen so each
       * spawned session can carry its own ephemeral `workingDirectory`
       * spawn arg.
       */
      pickDirectory?: (options?: {
        defaultPath?: string
      }) => Promise<string | null>
      showMenuSection?: (
        section: DesktopMenuSection,
        bounds: DesktopMenuPopupBounds,
        state: DesktopMenuState
      ) => Promise<void>
      showAppMenu?: (bounds: DesktopMenuPopupBounds) => Promise<void>
      getNavigationState?: () => Promise<DesktopNavigationState>
      navigateHistory?: (direction: `back` | `forward`) => Promise<void>
      onNavigationStateChanged?: (
        callback: (state: DesktopNavigationState) => void
      ) => () => void
      onDesktopStateChanged?: (
        callback: (state: DesktopState) => void
      ) => () => void
      onDesktopCommand?: (
        callback: (command: DesktopCommand) => void
      ) => () => void
      /**
       * Push-based view of the in-process MCP registry. `getSnapshot`
       * returns the latest state (or empty when no runtime is running);
       * `onState` subscribes to subsequent updates. Mutation verbs map
       * 1:1 to the registry methods that back them.
       */
      mcp?: {
        getSnapshot: (serverId?: string) => Promise<{
          seq: number
          servers: ReadonlyArray<unknown>
        }>
        onState: (
          callback: (
            payload:
              | {
                  seq: number
                  servers: ReadonlyArray<unknown>
                }
              | {
                  serverId: string
                  snapshot: {
                    seq: number
                    servers: ReadonlyArray<unknown>
                  }
                }
          ) => void
        ) => () => void
        authorize: (name: string, serverId?: string) => Promise<void>
        reconnect: (name: string, serverId?: string) => Promise<void>
        disable: (name: string, serverId?: string) => Promise<void>
        enable: (name: string, serverId?: string) => Promise<void>
      }
      /**
       * Electric Cloud sign-in surface. The Electron main process owns
       * the OAuth BrowserWindow and the JWT storage; the renderer only
       * observes state and triggers verbs.
       */
      cloudAuth?: {
        getState: () => Promise<CloudAuthState>
        signIn: (provider: CloudAuthProvider) => Promise<void>
        signOut: () => Promise<void>
        openDashboard: () => Promise<void>
        onStateChanged: (
          callback: (state: CloudAuthState) => void
        ) => () => void
      }
      cloudAgentServers?: {
        getState: () => Promise<CloudAgentServersState>
        onStateChanged: (
          callback: (state: CloudAgentServersState) => void
        ) => () => void
        prepareConnection: (
          serviceId: string
        ) => Promise<{ url: string; tenantId: string }>
      }
    }
  }
}

const STORAGE_KEY = `electric-agents-servers`

function browserServerId(url: string): string {
  return `web:${url}`
}

function normalizeBrowserServer(value: unknown): ServerConfig | null {
  if (!value || typeof value !== `object`) return null
  const maybe = value as Partial<ServerConfig>
  if (typeof maybe.name !== `string` || typeof maybe.url !== `string`) {
    return null
  }
  const name = maybe.name.trim()
  const url = maybe.url.trim()
  if (!name || !url) return null
  return {
    id:
      typeof maybe.id === `string` && maybe.id
        ? maybe.id
        : browserServerId(url),
    name,
    url,
    source: maybe.source ?? `manual`,
    desiredState: maybe.desiredState ?? `connected`,
    localRuntimeEnabled: maybe.localRuntimeEnabled !== false,
  }
}

export async function loadServers(): Promise<Array<ServerConfig>> {
  if (window.electronAPI) {
    return await window.electronAPI.getServers()
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown
      return Array.isArray(parsed)
        ? parsed
            .map((entry) => normalizeBrowserServer(entry))
            .filter((entry): entry is ServerConfig => entry !== null)
        : []
    } catch {
      return []
    }
  }
  return []
}

export async function saveServers(servers: Array<ServerConfig>): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.saveServers(servers)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
}

export async function loadDesktopState(): Promise<DesktopState | null> {
  return (await window.electronAPI?.getDesktopState?.()) ?? null
}

export async function saveActiveServer(
  server: ServerConfig | null
): Promise<void> {
  await window.electronAPI?.setActiveServer?.(server)
}

export async function saveSelectedServer(
  serverId: string | null
): Promise<void> {
  await window.electronAPI?.setSelectedServer?.(serverId)
}

export async function connectServer(serverId: string): Promise<void> {
  await window.electronAPI?.connectServer?.(serverId)
}

export async function disconnectServer(serverId: string): Promise<void> {
  await window.electronAPI?.disconnectServer?.(serverId)
}

export function onDesktopStateChanged(
  callback: (state: DesktopState) => void
): (() => void) | null {
  return window.electronAPI?.onDesktopStateChanged?.(callback) ?? null
}

/**
 * Trigger an immediate rescan of localhost ports for running
 * agents-server instances. Returns the freshly-discovered set so
 * callers can show inline feedback while waiting for the broadcast
 * via `onDesktopStateChanged` to update React state.
 */
export async function rescanDiscoveredServers(): Promise<
  Array<DiscoveredServer>
> {
  return (await window.electronAPI?.rescanServers?.()) ?? []
}

export async function loadApiKeysStatus(): Promise<ApiKeysStatus | null> {
  return (await window.electronAPI?.getApiKeysStatus?.()) ?? null
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await window.electronAPI?.saveApiKeys?.(keys)
}

export async function loadOnboardingState(): Promise<OnboardingState | null> {
  return (await window.electronAPI?.getOnboardingState?.()) ?? null
}

export async function setOnboardingDismissed(
  dismissed: boolean
): Promise<void> {
  await window.electronAPI?.setOnboardingDismissed?.(dismissed)
}

export async function loadCloudAuthState(): Promise<CloudAuthState | null> {
  return (await window.electronAPI?.cloudAuth?.getState?.()) ?? null
}

export async function cloudSignIn(provider: CloudAuthProvider): Promise<void> {
  await window.electronAPI?.cloudAuth?.signIn?.(provider)
}

export async function cloudSignOut(): Promise<void> {
  await window.electronAPI?.cloudAuth?.signOut?.()
}

export async function cloudOpenDashboard(): Promise<void> {
  await window.electronAPI?.cloudAuth?.openDashboard?.()
}

export function onCloudAuthStateChanged(
  callback: (state: CloudAuthState) => void
): (() => void) | null {
  return window.electronAPI?.cloudAuth?.onStateChanged?.(callback) ?? null
}

export async function loadCloudAgentServersState(): Promise<CloudAgentServersState | null> {
  return (await window.electronAPI?.cloudAgentServers?.getState?.()) ?? null
}

export function onCloudAgentServersStateChanged(
  callback: (state: CloudAgentServersState) => void
): (() => void) | null {
  return (
    window.electronAPI?.cloudAgentServers?.onStateChanged?.(callback) ?? null
  )
}

export async function prepareCloudAgentServerConnection(
  serviceId: string
): Promise<{ url: string; tenantId: string } | null> {
  return (
    (await window.electronAPI?.cloudAgentServers?.prepareConnection?.(
      serviceId
    )) ?? null
  )
}
