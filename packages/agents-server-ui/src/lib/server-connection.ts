import type { ServerConfig } from './types'

declare global {
  interface Window {
    electronAPI?: {
      getServers: () => Promise<Array<ServerConfig>>
      saveServers: (servers: Array<ServerConfig>) => Promise<void>
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
