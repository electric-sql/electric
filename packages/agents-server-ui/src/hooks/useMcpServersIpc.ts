import { useEffect, useState } from 'react'
import type { McpServerRow } from './mcpServerTypes'

export interface UseMcpServersIpcResult {
  servers: ReadonlyArray<McpServerRow>
  /** True until the first snapshot lands. */
  loading: boolean
  /**
   * Action wrappers — wired to the same IPC channels the main process
   * uses to talk to the registry. Awaitable so the caller can disable
   * UI elements during the action.
   */
  authorize(name: string): Promise<void>
  reconnect(name: string): Promise<void>
  disable(name: string): Promise<void>
  enable(name: string): Promise<void>
}

const noopAction = async () => {}

/**
 * Push-based view of the bundled runtime's MCP registry. Subscribes to
 * `electronAPI.mcp.onState` for snapshots and exposes the action verbs
 * over the same IPC namespace.
 *
 * Returns an empty list (and `loading: false`) when running in a
 * non-Electron context — callers should gate the page render on
 * `Boolean(window.electronAPI)` before invoking this hook.
 */
export function useMcpServersIpc(): UseMcpServersIpcResult {
  const mcp =
    typeof window !== `undefined` ? window.electronAPI?.mcp : undefined
  const [servers, setServers] = useState<ReadonlyArray<McpServerRow>>([])
  const [loading, setLoading] = useState(Boolean(mcp))

  useEffect(() => {
    if (!mcp) return
    let cancelled = false
    // The IPC payload comes typed as `unknown[]` to keep the global
    // `Window.electronAPI` type free of UI-package types — narrow at
    // the boundary and trust the runtime contract.
    void mcp.getSnapshot().then((snap) => {
      if (cancelled) return
      setServers(snap.servers as ReadonlyArray<McpServerRow>)
      setLoading(false)
    })
    const off = mcp.onState((snap) => {
      const snapshot = `snapshot` in snap ? snap.snapshot : snap
      setServers(snapshot.servers as ReadonlyArray<McpServerRow>)
      setLoading(false)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [mcp])

  if (!mcp) {
    return {
      servers: [],
      loading: false,
      authorize: noopAction,
      reconnect: noopAction,
      disable: noopAction,
      enable: noopAction,
    }
  }

  return {
    servers,
    loading,
    authorize: mcp.authorize,
    reconnect: mcp.reconnect,
    disable: mcp.disable,
    enable: mcp.enable,
  }
}
