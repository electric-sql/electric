import type { ServerConfig } from './types'

export type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

export interface DesktopState {
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
}

declare global {
  interface Window {
    electronAPI?: {
      getServers: () => Promise<Array<ServerConfig>>
      saveServers: (servers: Array<ServerConfig>) => Promise<void>
      getDesktopState?: () => Promise<DesktopState>
      setActiveServer?: (server: ServerConfig | null) => Promise<void>
      restartRuntime?: () => Promise<void>
      stopRuntime?: () => Promise<void>
      getWorkingDirectory?: () => Promise<string | null>
      chooseWorkingDirectory?: () => Promise<string | null>
      onDesktopStateChanged?: (
        callback: (state: DesktopState) => void
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
