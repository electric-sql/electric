import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  loadDesktopState,
  loadServers,
  onDesktopStateChanged,
  saveActiveServer,
  saveServers,
} from '../lib/server-connection'
import { registerActiveBaseUrl } from '../lib/entity-connection'
import type { ReactNode } from 'react'
import type { ServerConfig } from '../lib/types'

function currentServer(): ServerConfig {
  const origin = window.location.origin
  return {
    name: `This Server`,
    url: origin,
  }
}

interface ServerConnectionState {
  servers: Array<ServerConfig>
  activeServer: ServerConfig | null
  connected: boolean
  setActiveServer: (server: ServerConfig | null) => void
  addServer: (server: ServerConfig) => void
  removeServer: (url: string) => void
}

const ServerConnectionContext = createContext<ServerConnectionState | null>(
  null
)

export function ServerConnectionProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [servers, setServers] = useState<Array<ServerConfig>>([])
  const [activeServer, setActiveServerState] = useState<ServerConfig | null>(
    null
  )
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    Promise.all([loadServers(), loadDesktopState()])
      .then(([loaded, desktopState]) => {
        const next =
          loaded.length > 0
            ? loaded
            : window.electronAPI
              ? []
              : [currentServer()]
        const active =
          desktopState?.activeServer &&
          next.some((server) => server.url === desktopState.activeServer?.url)
            ? desktopState.activeServer
            : (next[0] ?? null)
        setServers(next)
        setActiveServerState(active)
        if (loaded.length === 0) {
          void saveServers(next)
        }
        if (active) {
          void saveActiveServer(active)
        }
      })
      .catch((err) => {
        console.error(`Failed to load saved servers:`, err)
        const next = window.electronAPI ? [] : [currentServer()]
        setServers(next)
        setActiveServerState(next[0] ?? null)
      })
  }, [])

  useEffect(() => {
    const unsubscribe = onDesktopStateChanged((state) => {
      setActiveServerState(state.activeServer)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    registerActiveBaseUrl(activeServer?.url ?? null)
  }, [activeServer])

  useEffect(() => {
    if (!activeServer) {
      setConnected(false)
      return
    }

    let cancelled = false

    const check = async () => {
      try {
        const res = await fetch(`${activeServer.url}/_electric/health`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!cancelled) setConnected(res.ok)
      } catch {
        if (!cancelled) setConnected(false)
      }
    }

    check()
    const interval = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeServer])

  const setActiveServer = useCallback((server: ServerConfig | null) => {
    setActiveServerState(server)
    void saveActiveServer(server)
  }, [])

  const addServer = useCallback(
    (server: ServerConfig) => {
      if (servers.some((s) => s.url === server.url)) return
      const next = [...servers, server]
      setServers(next)
      setActiveServerState(server)
      void saveServers(next).then(() => saveActiveServer(server))
    },
    [servers]
  )

  const removeServer = useCallback(
    (url: string) => {
      const next = servers.filter((s) => s.url !== url)
      setServers(next)
      void saveServers(next)
      if (activeServer?.url === url) {
        setActiveServer(next[0] ?? null)
      }
    },
    [servers, activeServer, setActiveServer]
  )

  return (
    <ServerConnectionContext.Provider
      value={{
        servers,
        activeServer,
        connected,
        setActiveServer,
        addServer,
        removeServer,
      }}
    >
      {children}
    </ServerConnectionContext.Provider>
  )
}

export function useServerConnection(): ServerConnectionState {
  const ctx = useContext(ServerConnectionContext)
  if (!ctx)
    throw new Error(
      `useServerConnection must be inside ServerConnectionProvider`
    )
  return ctx
}
