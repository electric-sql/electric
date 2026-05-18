import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import {
  connectServer as connectDesktopServer,
  disconnectServer as disconnectDesktopServer,
  loadDesktopState,
  loadServers,
  onDesktopStateChanged,
  saveActiveServer,
  saveSelectedServer,
  saveServers,
  type ServerConnectionState as RuntimeConnectionState,
} from '../lib/server-connection'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import { registerActiveBaseUrl } from '../lib/entity-connection'
import { registerActiveServerHeaders, serverFetch } from '../lib/auth-fetch'
import type { ReactNode } from 'react'
import type { ServerConfig } from '../lib/types'

type ServerInput = Pick<ServerConfig, `name` | `url`> & Partial<ServerConfig>

function createServerId(url: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `server:${url}`
}

function currentServer(): ServerConfig {
  const origin = window.location.origin
  return {
    id: `web:${origin}`,
    name: `This Server`,
    url: origin,
    source: `manual`,
    desiredState: `connected`,
    localRuntimeEnabled: false,
  }
}

function browserConnection(
  server: ServerConfig,
  status: RuntimeConnectionState[`status`],
  lastError: string | null = null
): RuntimeConnectionState {
  return {
    serverId: server.id,
    status,
    localRuntimeStatus: `disabled`,
    runtimeUrl: null,
    runtimeError: null,
    lastError,
    reconnectAttempt: 0,
    lastConnectedAt: status === `connected` ? Date.now() : null,
  }
}

function normalizeServerConfig(server: ServerConfig): ServerConfig {
  const headers = new Headers()
  for (const [rawName, rawValue] of Object.entries(server.headers ?? {})) {
    const name = rawName.trim()
    const value = rawValue.trim()
    if (!name || !value) continue
    try {
      headers.set(name, value)
    } catch {
      // Ignore invalid header rows from old localStorage/settings payloads.
    }
  }
  const normalizedHeaders = Object.fromEntries(headers.entries())
  return {
    id: server.id || createServerId(server.url),
    name: server.name.trim(),
    url: server.url.trim(),
    source: server.source ?? `manual`,
    desiredState: server.desiredState ?? `connected`,
    localRuntimeEnabled: server.localRuntimeEnabled ?? true,
    ...(Object.keys(normalizedHeaders).length > 0
      ? { headers: normalizedHeaders }
      : {}),
    // For `electric-cloud` source, the tenant ID is what the
    // desktop's webRequest hook + main-process undici interceptor
    // use to look up the matching service JWT in `SecretStore`.
    // Drop it from the normalized form for non-cloud sources so
    // we don't accidentally tag a manual server with a stale tenant.
    ...(server.source === `electric-cloud` && server.tenantId
      ? { tenantId: server.tenantId }
      : {}),
  }
}

interface ServerConnectionState {
  servers: Array<ServerConfig>
  activeServer: ServerConfig | null
  connected: boolean
  connection: RuntimeConnectionState | null
  connections: Array<RuntimeConnectionState>
  setActiveServer: (server: ServerConfig | null) => void
  addServer: (server: ServerInput) => void
  removeServer: (url: string) => void
  updateServer: (server: ServerConfig) => void
  connectServer: (serverId: string) => void
  disconnectServer: (serverId: string) => void
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
  const [connection, setConnection] = useState<RuntimeConnectionState | null>(
    null
  )
  const [connections, setConnections] = useState<Array<RuntimeConnectionState>>(
    []
  )
  const [browserRetry, setBrowserRetry] = useState(0)
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)

  useEffect(() => {
    Promise.all([loadServers(), loadDesktopState()])
      .then(([loaded, desktopState]) => {
        const next = desktopState?.servers?.length
          ? desktopState.servers
          : loaded.length > 0
            ? loaded
            : isDesktop
              ? []
              : [currentServer()]
        const active =
          desktopState?.activeServer ??
          (desktopState?.selectedServerId
            ? (next.find(
                (server) => server.id === desktopState.selectedServerId
              ) ?? null)
            : (next[0] ?? null))
        registerActiveBaseUrl(active?.url ?? null)
        registerActiveServerHeaders(active)
        setServers(next)
        setActiveServerState(active)
        const activeConnection =
          desktopState?.connections?.find((c) => c.serverId === active?.id) ??
          null
        setConnection(activeConnection)
        setConnections(desktopState?.connections ?? [])
        if (desktopState) setConnected(activeConnection?.status === `connected`)
        if (loaded.length === 0) {
          void saveServers(next)
        }
        if (active && !isDesktop) {
          void saveActiveServer(active)
        }
      })
      .catch((err) => {
        console.error(`Failed to load saved servers:`, err)
        const next = window.electronAPI ? [] : [currentServer()]
        registerActiveBaseUrl(next[0]?.url ?? null)
        registerActiveServerHeaders(next[0] ?? null)
        setServers(next)
        setActiveServerState(next[0] ?? null)
      })
  }, [isDesktop])

  useEffect(() => {
    const unsubscribe = onDesktopStateChanged((state) => {
      const nextServers = state.servers ?? servers
      setServers(nextServers)
      const active =
        state.activeServer ??
        nextServers.find((server) => server.id === state.selectedServerId) ??
        null
      registerActiveBaseUrl(active?.url ?? null)
      registerActiveServerHeaders(active)
      setActiveServerState(active)
      const activeConnection =
        state.connections?.find((c) => c.serverId === active?.id) ?? null
      setConnection(activeConnection)
      setConnections(state.connections ?? [])
      setConnected(activeConnection?.status === `connected`)
    })
    return () => {
      unsubscribe?.()
    }
  }, [servers])

  useEffect(() => {
    registerActiveBaseUrl(activeServer?.url ?? null)
    registerActiveServerHeaders(activeServer)
  }, [activeServer])

  useEffect(() => {
    if (isDesktop) return
    if (!activeServer) {
      setConnected(false)
      return
    }

    let cancelled = false
    let checked = false

    const check = async () => {
      if (!checked) {
        const nextConnecting = browserConnection(activeServer, `connecting`)
        setConnection(nextConnecting)
        setConnections([nextConnecting])
      }
      try {
        const res = await serverFetch(
          appendPathToUrl(activeServer.url, `/_electric/health`),
          {
            signal: AbortSignal.timeout(3000),
          }
        )
        if (!cancelled) {
          checked = true
          const nextConnection = browserConnection(
            activeServer,
            res.ok ? `connected` : `offline`,
            res.ok ? null : `Server returned ${res.status} ${res.statusText}`
          )
          setConnected(res.ok)
          setConnection(nextConnection)
          setConnections([nextConnection])
        }
      } catch (error) {
        if (!cancelled) {
          checked = true
          const message =
            error instanceof Error ? error.message : `Connection failed`
          const nextConnection = browserConnection(
            activeServer,
            `offline`,
            message
          )
          setConnected(false)
          setConnection(nextConnection)
          setConnections([nextConnection])
        }
      }
    }

    check()
    const interval = setInterval(check, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeServer, browserRetry, isDesktop])

  const setActiveServer = useCallback((server: ServerConfig | null) => {
    registerActiveBaseUrl(server?.url ?? null)
    registerActiveServerHeaders(server)
    setActiveServerState(server)
    if (window.electronAPI) {
      void saveSelectedServer(server?.id ?? null)
    } else {
      void saveActiveServer(server)
    }
  }, [])

  const addServer = useCallback(
    (server: ServerInput) => {
      if (servers.some((s) => s.url === server.url)) return
      const normalized = normalizeServerConfig(server as ServerConfig)
      const next = [...servers, normalized]
      setServers(next)
      setActiveServerState(normalized)
      registerActiveBaseUrl(normalized.url)
      registerActiveServerHeaders(normalized)
      void saveServers(next).then(async () => {
        if (window.electronAPI) {
          await saveSelectedServer(normalized.id)
          await connectDesktopServer(normalized.id)
        } else {
          await saveActiveServer(normalized)
        }
      })
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

  const updateServer = useCallback(
    (server: ServerConfig) => {
      const next = servers.map((candidate) =>
        candidate.id === server.id ? server : candidate
      )
      setServers(next)
      if (activeServer?.id === server.id) setActiveServerState(server)
      void saveServers(next)
    },
    [servers, activeServer]
  )

  const connectServer = useCallback(
    (serverId: string) => {
      if (window.electronAPI) {
        void connectDesktopServer(serverId)
      } else if (activeServer?.id === serverId) {
        setBrowserRetry((value) => value + 1)
      }
    },
    [activeServer]
  )

  const disconnectServer = useCallback((serverId: string) => {
    void disconnectDesktopServer(serverId)
  }, [])

  return (
    <ServerConnectionContext.Provider
      value={{
        servers,
        activeServer,
        connected,
        connection,
        connections,
        setActiveServer,
        addServer,
        removeServer,
        updateServer,
        connectServer,
        disconnectServer,
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
