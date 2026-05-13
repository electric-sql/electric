import { useEffect, useMemo, useState } from 'react'
import { Brain, RefreshCw, Square, Trash2, Zap } from 'lucide-react'
import { useServerConnection } from '../../../hooks/useServerConnection'
import { Badge, Button, Field, Icon, Input, Stack, Text } from '../../../ui'
import { SettingsRow, SettingsScreen, SettingsSection } from '../SettingsScreen'
import {
  loadCloudAgentServersState,
  loadDesktopState,
  onCloudAgentServersStateChanged,
  onDesktopStateChanged,
  prepareCloudAgentServerConnection,
  type CloudAgentServer,
  type CloudAgentServersState,
  type DiscoveredServer,
  type LocalRuntimeStatus,
  type ServerConnectionStatus,
} from '../../../lib/server-connection'
import type { ServerConfig } from '../../../lib/types'

const STATUS_TONES: Record<
  ServerConnectionStatus,
  { label: string; tone: `success` | `warning` | `danger` | `info` | `neutral` }
> = {
  connected: { label: `Connected`, tone: `success` },
  connecting: { label: `Connecting`, tone: `info` },
  reconnecting: { label: `Reconnecting`, tone: `info` },
  offline: { label: `Offline`, tone: `warning` },
  error: { label: `Error`, tone: `danger` },
  disconnected: { label: `Disconnected`, tone: `neutral` },
}

export function ServersPage(): React.ReactElement {
  const {
    servers,
    activeServer,
    connected,
    connections,
    addServer,
    setActiveServer,
    connectServer,
    disconnectServer,
    removeServer,
    updateServer,
  } = useServerConnection()
  const [discovered, setDiscovered] = useState<Array<DiscoveredServer>>([])
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const connectionByServer = useMemo(
    () => new Map(connections.map((entry) => [entry.serverId, entry])),
    [connections]
  )
  const savedUrls = useMemo(() => new Set(servers.map((s) => s.url)), [servers])
  const savedCloudTenantIds = useMemo(
    () =>
      new Set(
        servers
          .filter((s) => s.source === `electric-cloud` && s.tenantId)
          .map((s) => s.tenantId as string)
      ),
    [servers]
  )
  const newDiscovered = useMemo(
    () =>
      discovered
        .filter((entry) => !savedUrls.has(entry.url))
        .sort((a, b) => a.port - b.port),
    [discovered, savedUrls]
  )
  const statusForServer = (server: ServerConfig): ServerConnectionStatus => {
    const stored = connectionByServer.get(server.id)?.status
    if (stored) return stored
    if (!isDesktop && server.id === activeServer?.id) {
      return connected ? `connected` : `offline`
    }
    return server.desiredState === `connected` ? `offline` : `disconnected`
  }
  const runtimeStatusForServer = (server: ServerConfig): LocalRuntimeStatus => {
    if (!isDesktop) return `disabled`
    return (
      connectionByServer.get(server.id)?.localRuntimeStatus ??
      (server.localRuntimeEnabled ? `stopped` : `disabled`)
    )
  }

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadDesktopState().then((state) => {
      if (!cancelled) setDiscovered(state?.discoveredServers ?? [])
    })
    const off = onDesktopStateChanged((state) =>
      setDiscovered(state.discoveredServers ?? [])
    )
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  const [cloudAgents, setCloudAgents] = useState<CloudAgentServersState | null>(
    null
  )
  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadCloudAgentServersState().then((state) => {
      if (!cancelled) setCloudAgents(state)
    })
    const off = onCloudAgentServersStateChanged((next) => {
      setCloudAgents(next)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  return (
    <SettingsScreen title="Servers">
      <SettingsSection
        title="Configured Servers"
        description={
          isDesktop
            ? `Manage remote agents servers and the optional local runtime attached to each connected server.`
            : `Manage the agents server this web UI connects to. Local runtimes are only available in the desktop app.`
        }
      >
        {servers.length === 0 ? (
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              No configured servers yet. Add one from the server switcher.
            </Text>
          </div>
        ) : (
          servers.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              selected={server.id === activeServer?.id}
              status={statusForServer(server)}
              lastError={connectionByServer.get(server.id)?.lastError ?? null}
              runtimeStatus={runtimeStatusForServer(server)}
              runtimeUrl={connectionByServer.get(server.id)?.runtimeUrl ?? null}
              runtimeError={
                connectionByServer.get(server.id)?.runtimeError ?? null
              }
              onSelect={() => setActiveServer(server)}
              onConnect={() => connectServer(server.id)}
              onDisconnect={() => disconnectServer(server.id)}
              onToggleLocalRuntime={() => {
                if (!isDesktop) return
                updateServer({
                  ...server,
                  localRuntimeEnabled: server.localRuntimeEnabled === false,
                })
              }}
              onRemove={() => {
                if (
                  window.confirm(
                    `Remove ${server.name}? This will remove it from your configured servers.`
                  )
                ) {
                  removeServer(server.url)
                }
              }}
              isDesktop={isDesktop}
            />
          ))
        )}
      </SettingsSection>
      {isDesktop && (
        <CloudAgentServersSection
          state={cloudAgents}
          savedTenantIds={savedCloudTenantIds}
          onAdd={addServer}
        />
      )}
      <SettingsSection
        title="Add Server"
        description={
          isDesktop
            ? `Add a remote agents server. Connecting can run with or without a local bundled runtime.`
            : `Add another agents server URL for this browser. Local runtime options are not available on the web.`
        }
      >
        <AddServerForm
          onAdd={(server) => {
            addServer(server)
          }}
        />
      </SettingsSection>
      {isDesktop && newDiscovered.length > 0 && (
        <SettingsSection
          title="Discovered Local Servers"
          description="Local servers are not saved until you connect them."
        >
          {newDiscovered.map((entry) => (
            <SettingsRow
              key={entry.url}
              label={`localhost:${entry.port}`}
              description={entry.url}
              control={
                <Button
                  variant="soft"
                  tone="neutral"
                  onClick={() =>
                    addServer({
                      name: `localhost:${entry.port}`,
                      url: entry.url,
                      source: `local-discovery`,
                      desiredState: `connected`,
                      localRuntimeEnabled: true,
                    })
                  }
                >
                  Connect
                </Button>
              }
            />
          ))}
        </SettingsSection>
      )}
    </SettingsScreen>
  )
}

function ServerRow({
  server,
  selected,
  status,
  runtimeStatus,
  lastError,
  runtimeUrl,
  runtimeError,
  onSelect,
  onConnect,
  onDisconnect,
  onToggleLocalRuntime,
  onRemove,
  isDesktop,
}: {
  server: ServerConfig
  selected: boolean
  status: ServerConnectionStatus
  runtimeStatus: LocalRuntimeStatus
  lastError: string | null
  runtimeUrl: string | null
  runtimeError: string | null
  onSelect: () => void
  onConnect: () => void
  onDisconnect: () => void
  onToggleLocalRuntime: () => void
  onRemove: () => void
  isDesktop: boolean
}): React.ReactElement {
  const statusInfo = STATUS_TONES[status]
  const connectedIntent = server.desiredState === `connected`
  return (
    <>
      <SettingsRow
        label={server.name}
        description={
          <Stack direction="column" gap={1}>
            <Text size={1} tone="muted" family="mono">
              {server.url}
            </Text>
            {runtimeUrl && (
              <Text size={1} tone="muted" family="mono">
                Runtime: {runtimeUrl}
              </Text>
            )}
            {isDesktop ? (
              <Text size={1} tone="muted">
                <Icon icon={Brain} size={1} /> Local runtime for this server:
                {` `}
                {runtimeStatus}
              </Text>
            ) : (
              <Text size={1} tone="muted">
                Local runtime: desktop app only
              </Text>
            )}
            {runtimeError && (
              <Text size={1} tone="danger">
                Runtime: {runtimeError}
              </Text>
            )}
            {isDesktop && (
              <Text size={1} tone="muted">
                Logs: runtime logs are written under the app data logs
                directory.
              </Text>
            )}
            {lastError && (
              <Text size={1} tone="danger">
                {lastError}
              </Text>
            )}
          </Stack>
        }
        control={<Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>}
      />
      <div
        style={{
          display: `flex`,
          flexWrap: `wrap`,
          justifyContent: `flex-end`,
          gap: 8,
          padding: `0 16px 16px`,
        }}
      >
        <Button
          variant="soft"
          tone="neutral"
          onClick={onSelect}
          disabled={selected}
        >
          {selected ? `Selected` : `Select`}
        </Button>
        {isDesktop && connectedIntent ? (
          <>
            <Button variant="soft" tone="neutral" onClick={onConnect}>
              <Icon icon={RefreshCw} size={2} /> Retry
            </Button>
            <Button variant="soft" tone="neutral" onClick={onDisconnect}>
              <Icon icon={Square} size={2} /> Disconnect
            </Button>
          </>
        ) : isDesktop ? (
          <Button variant="solid" tone="accent" onClick={onConnect}>
            <Icon icon={Zap} size={2} /> Connect
          </Button>
        ) : null}
        {isDesktop && (
          <Button variant="soft" tone="neutral" onClick={onToggleLocalRuntime}>
            <Icon icon={Brain} size={2} />
            {server.localRuntimeEnabled === false
              ? `Enable local runtime`
              : `Disable local runtime`}
          </Button>
        )}
        <Button variant="soft" tone="neutral" onClick={onRemove}>
          <Icon icon={Trash2} size={2} /> Remove
        </Button>
      </div>
    </>
  )
}

function CloudAgentServersSection({
  state,
  savedTenantIds,
  onAdd,
}: {
  state: CloudAgentServersState | null
  savedTenantIds: Set<string>
  onAdd: (server: {
    name: string
    url: string
    source: `manual` | `local-discovery` | `electric-cloud`
    desiredState: `connected` | `disconnected`
    localRuntimeEnabled: boolean
    tenantId?: string
  }) => void
}): React.ReactElement {
  const status = state?.status ?? `idle`
  const servers = state?.servers ?? []
  const description =
    status === `idle`
      ? `Sign in to Electric Cloud (Settings → Account) to see the agent servers your workspaces have access to.`
      : status === `loading`
        ? `Loading agent servers from Electric Cloud…`
        : status === `unauthorized`
          ? `Sign-in expired. Sign back in (Settings → Account) to refresh the list.`
          : servers.length === 0
            ? `No agent servers in your workspaces yet. Create one from the Electric Cloud dashboard.`
            : `Agent servers across the workspaces you're a member of. Click Connect on one to make it the active server for this window.`

  return (
    <SettingsSection title="Cloud Agent Servers" description={description}>
      {state?.error && status !== `unauthorized` && (
        <div style={{ padding: `8px 16px 0` }}>
          <Text size={1} tone="danger">
            {state.error}
          </Text>
        </div>
      )}
      {servers.length > 0 && (
        <div>
          {servers.map((server) => (
            <CloudAgentServerRow
              key={server.id}
              server={server}
              savedTenantIds={savedTenantIds}
              onAdd={onAdd}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  )
}

function CloudAgentServerRow({
  server,
  savedTenantIds,
  onAdd,
}: {
  server: CloudAgentServer
  savedTenantIds: Set<string>
  onAdd: (server: {
    name: string
    url: string
    source: `manual` | `local-discovery` | `electric-cloud`
    desiredState: `connected` | `disconnected`
    localRuntimeEnabled: boolean
    tenantId?: string
  }) => void
}): React.ReactElement {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alreadyAdded = savedTenantIds.has(server.id)

  const path = [
    server.workspaceName,
    server.projectName,
    server.environmentName,
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(` › `)

  const handleConnect = async (): Promise<void> => {
    if (connecting || alreadyAdded) return
    setConnecting(true)
    setError(null)
    try {
      const result = await prepareCloudAgentServerConnection(server.id)
      if (!result) {
        throw new Error(`Could not prepare the cloud connection.`)
      }
      onAdd({
        name: server.name,
        url: result.url,
        source: `electric-cloud`,
        desiredState: `connected`,
        // The cloud-agents-server itself is just a tenanted router —
        // entity-type registration (Horton, Worker) and the actual
        // runtime execution still live on this machine. Same wiring
        // as a local server; the only difference is the agents-server
        // URL points at the cloud instead of `localhost`.
        localRuntimeEnabled: true,
        // Persisted alongside the URL so main's webRequest hook + the
        // undici global interceptor can look up the matching JWT
        // from SecretStore on every outbound request to this server.
        tenantId: result.tenantId,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <SettingsRow
      label={server.name}
      description={
        <Stack direction="column" gap={1}>
          {path && (
            <Text size={1} tone="muted">
              {path}
            </Text>
          )}
          <Text size={1} tone="muted" family="mono">
            {server.id}
          </Text>
          {error && (
            <Text size={1} tone="danger">
              {error}
            </Text>
          )}
        </Stack>
      }
      control={
        <Stack direction="row" gap={2} align="center">
          <Badge tone="info" size={1}>
            Cloud
          </Badge>
          <Button
            variant="soft"
            tone="neutral"
            size={1}
            disabled={connecting || alreadyAdded}
            onClick={() => {
              void handleConnect()
            }}
          >
            {alreadyAdded ? `Added` : connecting ? `Connecting…` : `Connect`}
          </Button>
        </Stack>
      }
    />
  )
}

function AddServerForm({
  onAdd,
}: {
  onAdd: (server: {
    name: string
    url: string
    source: `manual`
    desiredState: `connected`
    localRuntimeEnabled: boolean
  }) => void
}): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [name, setName] = useState(``)
  const [url, setUrl] = useState(``)
  const [localRuntimeEnabled, setLocalRuntimeEnabled] = useState(isDesktop)
  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  const canSubmit = trimmedName.length > 0 && trimmedUrl.length > 0

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        onAdd({
          name: trimmedName,
          url: trimmedUrl,
          source: `manual`,
          desiredState: `connected`,
          localRuntimeEnabled: isDesktop ? localRuntimeEnabled : false,
        })
        setName(``)
        setUrl(``)
        setLocalRuntimeEnabled(true)
      }}
      style={{
        display: `flex`,
        flexDirection: `column`,
        gap: 16,
        padding: 16,
      }}
    >
      <Stack direction="column" gap={3}>
        <Field label="Name">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Production"
            size={2}
          />
        </Field>
        <Field label="URL">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="e.g. https://agents.example.com"
            type="url"
            size={2}
          />
        </Field>
        {isDesktop && (
          <label style={{ display: `flex`, gap: 8, alignItems: `center` }}>
            <input
              type="checkbox"
              checked={localRuntimeEnabled}
              onChange={(event) => setLocalRuntimeEnabled(event.target.checked)}
            />
            <Text size={2}>Start a local runtime for this server</Text>
          </label>
        )}
      </Stack>
      <Stack justify="end">
        <Button type="submit" disabled={!canSubmit}>
          Add and connect
        </Button>
      </Stack>
    </form>
  )
}
