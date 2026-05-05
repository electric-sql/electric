import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import { loadServers, saveServers } from '../lib/server-connection'
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
  setActiveServer: (server: ServerConfig) => void
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
    loadServers()
      .then((loaded) => {
        const next = loaded.length > 0 ? loaded : [currentServer()]
        setServers(next)
        setActiveServerState(next[0] ?? null)
        if (loaded.length === 0) {
          void saveServers(next)
        }
      })
      .catch((err) => {
        console.error(`Failed to load saved servers:`, err)
        const next = [currentServer()]
        setServers(next)
        setActiveServerState(next[0] ?? null)
      })
  }, [])

  // Keep the module-level accessor in sync so the route loader
  // (outside React context) can call connectEntityStream.
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

  const addServer = useCallback(
    (server: ServerConfig) => {
      if (servers.some((s) => s.url === server.url)) return
      const next = [...servers, server]
      setServers(next)
      saveServers(next)
      setActiveServerState(server)
    },
    [servers]
  )

  const removeServer = useCallback(
    (url: string) => {
      const next = servers.filter((s) => s.url !== url)
      setServers(next)
      saveServers(next)
      if (activeServer?.url === url) {
        setActiveServerState(next[0] ?? null)
      }
    },
    [servers, activeServer]
  )

  return (
    <ServerConnectionContext.Provider
      value={{
        servers,
        activeServer,
        connected,
        setActiveServer: setActiveServerState,
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
