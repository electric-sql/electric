import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ReactNode } from 'react'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`
const SERVERS_KEY = `electric-agents-mobile.servers`
const ACTIVE_SERVER_URL_KEY = `electric-agents-mobile.active-server-url`

export type MobileServerConfig = {
  name: string
  url: string
}

type MobileAppState = {
  loading: boolean
  servers: Array<MobileServerConfig>
  activeServer: MobileServerConfig | null
  serverUrl: string | null
  saveServerUrl: (next: string) => Promise<void>
  addServer: (server: MobileServerConfig) => Promise<void>
  setActiveServerUrl: (url: string) => Promise<void>
  removeServer: (url: string) => Promise<void>
}

const MobileAppStateContext = createContext<MobileAppState | null>(null)

export function MobileAppStateProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [servers, setServers] = useState<Array<MobileServerConfig>>([])
  const [activeServerUrl, setActiveServerUrlState] = useState<string | null>(
    null
  )

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SERVERS_KEY),
      AsyncStorage.getItem(ACTIVE_SERVER_URL_KEY),
      AsyncStorage.getItem(SERVER_URL_KEY),
    ])
      .then(([storedServers, storedActiveUrl, legacyUrl]) => {
        const parsedServers = parseServers(storedServers)
        const nextServers =
          parsedServers.length > 0
            ? parsedServers
            : legacyUrl
              ? [serverFromUrl(legacyUrl)]
              : []
        const nextActiveUrl =
          pickActiveUrl(nextServers, storedActiveUrl) ??
          pickActiveUrl(nextServers, legacyUrl)

        setServers(nextServers)
        setActiveServerUrlState(nextActiveUrl)
      })
      .finally(() => setLoading(false))
  }, [])

  const persist = useCallback(
    async (
      nextServers: Array<MobileServerConfig>,
      nextActiveUrl: string | null
    ): Promise<void> => {
      setServers(nextServers)
      setActiveServerUrlState(nextActiveUrl)

      const writes: Array<[string, string]> = [
        [SERVERS_KEY, JSON.stringify(nextServers)],
      ]
      if (nextActiveUrl) {
        writes.push([ACTIVE_SERVER_URL_KEY, nextActiveUrl])
        writes.push([SERVER_URL_KEY, nextActiveUrl])
      }

      await AsyncStorage.multiSet(writes)
      if (!nextActiveUrl) {
        await AsyncStorage.multiRemove([ACTIVE_SERVER_URL_KEY, SERVER_URL_KEY])
      }
    },
    []
  )

  const addServer = useCallback(
    async (server: MobileServerConfig): Promise<void> => {
      const nextServer = normalizeServerConfig(server)
      const withoutExisting = servers.filter(
        (item) => item.url !== nextServer.url
      )
      const nextServers = [...withoutExisting, nextServer]
      await persist(nextServers, nextServer.url)
    },
    [persist, servers]
  )

  const saveServerUrl = useCallback(
    async (next: string): Promise<void> => {
      await addServer(serverFromUrl(next))
    },
    [addServer]
  )

  const setActiveServerUrl = useCallback(
    async (url: string): Promise<void> => {
      if (!servers.some((server) => server.url === url)) return
      await persist(servers, url)
    },
    [persist, servers]
  )

  const removeServer = useCallback(
    async (url: string): Promise<void> => {
      const nextServers = servers.filter((server) => server.url !== url)
      const nextActiveUrl =
        activeServerUrl === url
          ? (nextServers[0]?.url ?? null)
          : pickActiveUrl(nextServers, activeServerUrl)
      await persist(nextServers, nextActiveUrl)
    },
    [activeServerUrl, persist, servers]
  )

  const activeServer = useMemo(
    () => servers.find((server) => server.url === activeServerUrl) ?? null,
    [activeServerUrl, servers]
  )
  const serverUrl = activeServer?.url ?? null

  const value = useMemo<MobileAppState>(
    () => ({
      loading,
      servers,
      activeServer,
      serverUrl,
      saveServerUrl,
      addServer,
      setActiveServerUrl,
      removeServer,
    }),
    [
      activeServer,
      addServer,
      loading,
      removeServer,
      saveServerUrl,
      serverUrl,
      servers,
      setActiveServerUrl,
    ]
  )

  return (
    <MobileAppStateContext.Provider value={value}>
      {children}
    </MobileAppStateContext.Provider>
  )
}

export function useMobileAppState(): MobileAppState {
  const value = useContext(MobileAppStateContext)
  if (!value) {
    throw new Error(
      `useMobileAppState must be used inside MobileAppStateProvider`
    )
  }
  return value
}

function parseServers(input: string | null): Array<MobileServerConfig> {
  if (!input) return []
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) =>
        item && typeof item === `object`
          ? normalizeServerConfig(item as Partial<MobileServerConfig>)
          : null
      )
      .filter((item): item is MobileServerConfig => item !== null)
  } catch {
    return []
  }
}

function normalizeServerConfig(
  server: Partial<MobileServerConfig>
): MobileServerConfig {
  const url = String(server.url ?? ``)
  const name = String(server.name ?? ``).trim() || serverNameFromUrl(url)
  return { name, url }
}

function serverFromUrl(url: string): MobileServerConfig {
  return { name: serverNameFromUrl(url), url }
}

function serverNameFromUrl(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function pickActiveUrl(
  servers: Array<MobileServerConfig>,
  preferredUrl: string | null
): string | null {
  if (preferredUrl && servers.some((server) => server.url === preferredUrl)) {
    return preferredUrl
  }
  return servers[0]?.url ?? null
}
