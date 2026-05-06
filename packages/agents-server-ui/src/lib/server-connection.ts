import type { ServerConfig } from './types'

export type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

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
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  discoveredServers: Array<DiscoveredServer>
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
  | `open-search`
  | `open-find`
  | `find-next`
  | `find-previous`
  | `split-right`
  | `split-down`
  | `cycle-tile`

declare global {
  interface Window {
    electronAPI?: {
      getServers: () => Promise<Array<ServerConfig>>
      saveServers: (servers: Array<ServerConfig>) => Promise<void>
      getDesktopState?: () => Promise<DesktopState>
      setActiveServer?: (server: ServerConfig | null) => Promise<void>
      restartRuntime?: () => Promise<void>
      stopRuntime?: () => Promise<void>
      rescanServers?: () => Promise<Array<DiscoveredServer>>
      getApiKeysStatus?: () => Promise<ApiKeysStatus>
      saveApiKeys?: (keys: ApiKeys) => Promise<void>
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
      onDesktopStateChanged?: (
        callback: (state: DesktopState) => void
      ) => () => void
      onDesktopCommand?: (
        callback: (command: DesktopCommand) => void
      ) => () => void
    }
  }
}

const STORAGE_KEY = `electric-agents-servers`

export async function loadServers(): Promise<Array<ServerConfig>> {
  if (window.electronAPI) {
    return await window.electronAPI.getServers()
  }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored)
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
