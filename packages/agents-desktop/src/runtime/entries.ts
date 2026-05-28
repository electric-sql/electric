import type {
  DesktopRuntimeStatus,
  RuntimeEntry,
  ServerConfig,
  ServerConnectionState,
} from '../shared/types'

export function createConnectionState(
  entry: RuntimeEntry
): ServerConnectionState {
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

export function ensureRuntimeEntry(
  entries: Map<string, RuntimeEntry>,
  server: ServerConfig
): RuntimeEntry {
  const existing = entries.get(server.id)
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
  entries.set(server.id, entry)
  return entry
}

export function runtimeStatusForConnection(
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
