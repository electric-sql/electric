import { useEffect, useMemo, useState } from 'react'
import { useServerConnection } from './useServerConnection'
import {
  loadCloudAuthState,
  loadCloudAgentServersState,
  loadDesktopState,
  onCloudAuthStateChanged,
  onCloudAgentServersStateChanged,
  onDesktopStateChanged,
  type CloudAuthState,
  type CloudAgentServer,
  type CloudAgentServersState,
  type DiscoveredServer,
  type LocalRuntimeStatus,
  type ServerConnectionState,
  type ServerConnectionStatus,
} from '../lib/server-connection'
import type { ServerConfig } from '../lib/types'

export type AvailableServerKind = `saved` | `cloud` | `local`

export interface AvailableServer {
  key: string
  kind: AvailableServerKind
  name: string
  description: string | null
  url: string | null
  tenantId: string | null
  cloudPath: string | null
  server: ServerConfig | null
  cloudServer: CloudAgentServer | null
  discoveredServer: DiscoveredServer | null
  connection: ServerConnectionState | null
  status: ServerConnectionStatus
  runtimeStatus: LocalRuntimeStatus
  isSelected: boolean
  isSaved: boolean
  isCloud: boolean
  isLocal: boolean
}

export interface AvailableServersState {
  servers: Array<AvailableServer>
  cloudState: CloudAgentServersState | null
  discoveredServers: Array<DiscoveredServer>
}

export function useAvailableServers(): AvailableServersState {
  const { servers, activeServer, connected, connections } =
    useServerConnection()
  const [discoveredServers, setDiscoveredServers] = useState<
    Array<DiscoveredServer>
  >([])
  const [cloudState, setCloudState] = useState<CloudAgentServersState | null>(
    null
  )
  const [cloudAuthState, setCloudAuthState] = useState<CloudAuthState | null>(
    null
  )
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadDesktopState().then((state) => {
      if (!cancelled) setDiscoveredServers(state?.discoveredServers ?? [])
    })
    const off = onDesktopStateChanged((state) => {
      setDiscoveredServers(state.discoveredServers ?? [])
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadCloudAuthState().then((state) => {
      if (!cancelled) setCloudAuthState(state)
    })
    const off = onCloudAuthStateChanged((next) => {
      setCloudAuthState(next)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadCloudAgentServersState().then((state) => {
      if (!cancelled) setCloudState(state)
    })
    const off = onCloudAgentServersStateChanged((next) => {
      setCloudState(next)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  return useMemo(() => {
    const connectionByServer = new Map(
      connections.map((entry) => [entry.serverId, entry])
    )
    const cloudByTenant = new Map(
      (cloudState?.servers ?? []).map((server) => [server.id, server])
    )
    const workspaceNameById = new Map(
      (cloudAuthState?.workspaces ?? []).map((workspace) => [
        workspace.id,
        workspace.name,
      ])
    )
    const savedUrls = new Set(servers.map((server) => server.url))
    const savedTenantIds = new Set(
      servers
        .filter(
          (server) => server.source === `electric-cloud` && server.tenantId
        )
        .map((server) => server.tenantId as string)
    )

    const savedItems = servers.map((server): AvailableServer => {
      const connection = connectionByServer.get(server.id) ?? null
      const cloudServer = server.tenantId
        ? (cloudByTenant.get(server.tenantId) ?? null)
        : null
      const cloudPath = cloudServer
        ? cloudServerPath(
            cloudServer,
            workspaceNameById.get(cloudServer.workspaceId ?? ``) ?? null
          )
        : null
      const status =
        connection?.status ??
        (!isDesktop && server.id === activeServer?.id
          ? connected
            ? `connected`
            : `offline`
          : server.desiredState === `connected`
            ? `offline`
            : `disconnected`)
      const isCloud = server.source === `electric-cloud`
      const displayName = isCloud
        ? (cloudServer?.name ?? server.name)
        : server.name
      return {
        key: `saved:${server.id}`,
        kind: `saved`,
        name: displayName,
        description: cloudPath,
        url: server.url,
        tenantId: server.tenantId ?? null,
        cloudPath,
        server,
        cloudServer,
        discoveredServer: null,
        connection,
        status,
        runtimeStatus:
          connection?.localRuntimeStatus ??
          (server.localRuntimeEnabled === false ? `disabled` : `stopped`),
        isSelected: server.id === activeServer?.id,
        isSaved: true,
        isCloud,
        isLocal: isLocalServerUrl(server.url),
      }
    })

    const cloudItems = (cloudState?.servers ?? [])
      .filter((server) => !savedTenantIds.has(server.id))
      .map((server): AvailableServer => {
        const cloudPath = cloudServerPath(
          server,
          workspaceNameById.get(server.workspaceId ?? ``) ?? null
        )
        return {
          key: `cloud:${server.id}`,
          kind: `cloud`,
          name: server.name,
          description: cloudPath,
          url: null,
          tenantId: server.id,
          cloudPath,
          server: null,
          cloudServer: server,
          discoveredServer: null,
          connection: null,
          status: `disconnected`,
          runtimeStatus: `disabled`,
          isSelected: false,
          isSaved: false,
          isCloud: true,
          isLocal: false,
        }
      })

    const localItems = discoveredServers
      .filter((entry) => !savedUrls.has(entry.url))
      .sort((a, b) => a.port - b.port)
      .map(
        (entry): AvailableServer => ({
          key: `local:${entry.url}`,
          kind: `local`,
          name: `localhost:${entry.port}`,
          description: entry.url,
          url: entry.url,
          tenantId: null,
          cloudPath: null,
          server: null,
          cloudServer: null,
          discoveredServer: entry,
          connection: null,
          status: `disconnected`,
          runtimeStatus: `disabled`,
          isSelected: false,
          isSaved: false,
          isCloud: false,
          isLocal: true,
        })
      )

    return {
      servers: [...savedItems, ...cloudItems, ...localItems],
      cloudState,
      discoveredServers,
    }
  }, [
    activeServer?.id,
    cloudAuthState,
    cloudState,
    connected,
    connections,
    discoveredServers,
    isDesktop,
    servers,
  ])
}

function cloudServerPath(
  server: CloudAgentServer,
  fallbackWorkspaceName: string | null
): string | null {
  const path = [
    server.workspaceName ?? fallbackWorkspaceName,
    server.projectName,
    server.environmentName,
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(` / `)
  return path || null
}

function isLocalServerUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === `localhost` ||
      hostname === `127.0.0.1` ||
      hostname === `0.0.0.0` ||
      hostname === `::1` ||
      hostname === `[::1]`
    )
  } catch {
    return false
  }
}
