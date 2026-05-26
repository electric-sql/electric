import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Brain,
  ChevronDown,
  Cloud,
  ExternalLink,
  Laptop,
  Plug,
  RefreshCw,
  Trash2,
  Unplug,
} from 'lucide-react'
import {
  useAvailableServers,
  type AvailableServer,
} from '../../../hooks/useAvailableServers'
import { useServerConnection } from '../../../hooks/useServerConnection'
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Icon,
  IconButton,
  Input,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '../../../ui'
import {
  SettingsActions,
  SettingsInset,
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
} from '../SettingsScreen'
import {
  cloudOpenCreateAgentsServer,
  prepareCloudAgentServerConnection,
  type CloudAgentServersState,
  type ConnectServerOptions,
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
  const navigate = useNavigate()
  const {
    addServer,
    setActiveServer,
    connectServer,
    disconnectServer,
    forgetServer,
    updateServer,
  } = useServerConnection()
  const { servers, cloudState } = useAvailableServers()
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [serverToForget, setServerToForget] = useState<ServerConfig | null>(
    null
  )

  const connectAvailableServer = async (
    item: AvailableServer,
    options: ConnectServerOptions
  ): Promise<void> => {
    if (item.server) {
      connectServer(item.server.id, options)
      return
    }
    if (item.cloudServer) {
      const result = await prepareCloudAgentServerConnection(
        item.cloudServer.id
      )
      if (!result) throw new Error(`Could not prepare the cloud connection.`)
      addServer(
        {
          name: item.cloudServer.name,
          url: result.url,
          source: `electric-cloud`,
          desiredState: `connected`,
          localRuntimeEnabled: options.localRuntimeEnabled !== false,
          tenantId: result.tenantId,
        },
        options
      )
      return
    }
    if (item.discoveredServer) {
      addServer(
        {
          name: item.name,
          url: item.discoveredServer.url,
          source: `local-discovery`,
          desiredState: `connected`,
          localRuntimeEnabled: options.localRuntimeEnabled !== false,
        },
        options
      )
    }
  }

  const cloudDescription = cloudStatusDescription(cloudState)

  return (
    <>
      <SettingsScreen title="Servers">
        <SettingsSection
          title="Servers"
          description={
            isDesktop
              ? `Connect to local, self-hosted, or Electric Cloud agents servers.`
              : `Manage the agents server this web UI connects to.`
          }
        >
          {cloudDescription && (
            <SettingsPanel>
              <Text
                size={1}
                tone={cloudState?.status === `error` ? `danger` : `muted`}
              >
                {cloudDescription}
              </Text>
            </SettingsPanel>
          )}
          {servers.length === 0 ? (
            <SettingsPanel>
              <Text size={2} tone="muted">
                No servers yet. Add one below or sign in to Electric Cloud.
              </Text>
            </SettingsPanel>
          ) : (
            servers.map((item) => (
              <ServerRow
                key={item.key}
                item={item}
                onSelect={() => item.server && setActiveServer(item.server)}
                onConnect={(options) => {
                  void connectAvailableServer(item, options)
                }}
                onDisconnect={() =>
                  item.server && disconnectServer(item.server.id)
                }
                onToggleLocalRuntime={() => {
                  if (!item.server) return
                  const localRuntimeEnabled =
                    item.server.localRuntimeEnabled === false
                  updateServer({
                    ...item.server,
                    localRuntimeEnabled,
                  })
                  if (
                    localRuntimeEnabled &&
                    item.server.desiredState === `connected`
                  ) {
                    connectServer(item.server.id, {
                      localRuntimeEnabled: true,
                    })
                  }
                }}
                onForget={() => {
                  if (item.server) setServerToForget(item.server)
                }}
                onInspectRuntime={() => {
                  if (!item.server) return
                  void navigate({
                    to: `/settings/$category`,
                    params: { category: `local-runtime` },
                    search: { serverId: item.server.id },
                  })
                }}
                isDesktop={isDesktop}
              />
            ))
          )}
        </SettingsSection>
        <SettingsSection
          title="Electric Cloud"
          description="Create a hosted agents server in Electric Cloud."
          action={
            <Button
              variant="solid"
              tone="accent"
              disabled={!isDesktop}
              onClick={() => {
                void cloudOpenCreateAgentsServer()
              }}
            >
              <Icon icon={ExternalLink} size={2} />
              Create Server in Electric Cloud
            </Button>
          }
        />
        <SettingsSection
          title="Add Local Or Self-Hosted Server"
          description={
            isDesktop
              ? `Add a local or self-hosted server URL manually. New connections start the local runtime by default.`
              : `Add another local or self-hosted agents server URL for this browser.`
          }
        >
          <AddServerForm
            onAdd={(server) => {
              addServer(server, {
                localRuntimeEnabled: server.localRuntimeEnabled,
              })
            }}
          />
        </SettingsSection>
      </SettingsScreen>
      <ConfirmDialog
        open={serverToForget !== null}
        onOpenChange={(open) => {
          if (!open) setServerToForget(null)
        }}
        title={
          serverToForget ? `Forget ${serverToForget.name}?` : `Forget server?`
        }
        description="This will disconnect the server and remove its saved settings."
        confirmLabel="Forget server"
        confirmTone="danger"
        confirmIcon={Trash2}
        onConfirm={() => {
          if (!serverToForget) return
          forgetServer(serverToForget.id)
          setServerToForget(null)
        }}
      />
    </>
  )
}

function ServerRow({
  item,
  onSelect,
  onConnect,
  onDisconnect,
  onToggleLocalRuntime,
  onForget,
  onInspectRuntime,
  isDesktop,
}: {
  item: AvailableServer
  onSelect: () => void
  onConnect: (options: ConnectServerOptions) => void
  onDisconnect: () => void
  onToggleLocalRuntime: () => void
  onForget: () => void
  onInspectRuntime: () => void
  isDesktop: boolean
}): React.ReactElement {
  const statusInfo = STATUS_TONES[item.status]
  const connectedIntent = item.server?.desiredState === `connected`
  const canUseLocalRuntime = isDesktop && item.isSaved
  const canInspectRuntime =
    canUseLocalRuntime &&
    connectedIntent &&
    item.status === `connected` &&
    item.server?.localRuntimeEnabled !== false
  const badgeText = item.isCloud ? item.cloudPath : item.description
  return (
    <>
      <SettingsRow
        label={item.name}
        description={
          <Stack direction="row" gap={2} align="center">
            <ServerKindBadge item={item} />
            {badgeText && (
              <Text size={1} tone="muted">
                {badgeText}
              </Text>
            )}
          </Stack>
        }
        control={<Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>}
      />
      {(item.url ||
        canUseLocalRuntime ||
        item.connection?.runtimeError ||
        item.connection?.lastError) && (
        <SettingsInset>
          <Stack direction="column" gap={1}>
            {item.url && item.url !== item.description && (
              <Text size={1} tone="muted" family="mono">
                {item.url}
              </Text>
            )}
            {canUseLocalRuntime && (
              <span
                style={{
                  display: `inline-flex`,
                  alignItems: `center`,
                  gap: 6,
                }}
              >
                <Text size={1} tone="muted">
                  Local runtime: {runtimeStatusLabel(item.runtimeStatus)}
                </Text>
                {canInspectRuntime && (
                  <Tooltip content="Inspect local runtime">
                    <IconButton
                      size={1}
                      variant="ghost"
                      tone="neutral"
                      onClick={onInspectRuntime}
                      aria-label={`Inspect runtime for ${item.name}`}
                    >
                      <Icon icon={ExternalLink} size={1} />
                    </IconButton>
                  </Tooltip>
                )}
              </span>
            )}
            {item.connection?.runtimeError && (
              <Text size={1} tone="danger">
                Runtime: {item.connection.runtimeError}
              </Text>
            )}
            {item.connection?.lastError && (
              <Text size={1} tone="danger">
                {item.connection.lastError}
              </Text>
            )}
          </Stack>
        </SettingsInset>
      )}
      <SettingsActions>
        {item.server && (
          <Button
            variant="soft"
            tone="neutral"
            onClick={onSelect}
            disabled={item.isSelected}
          >
            {item.isSelected ? `Selected` : `Select`}
          </Button>
        )}
        {isDesktop && connectedIntent ? (
          <>
            <Button
              variant="soft"
              tone="neutral"
              onClick={() =>
                onConnect({
                  localRuntimeEnabled:
                    item.server?.localRuntimeEnabled !== false,
                })
              }
            >
              <Icon icon={RefreshCw} size={2} /> Retry
            </Button>
            <Button variant="soft" tone="neutral" onClick={onDisconnect}>
              <Icon icon={Plug} size={2} /> Disconnect
            </Button>
          </>
        ) : isDesktop ? (
          <ConnectSplitButton onConnect={onConnect} />
        ) : null}
        {canUseLocalRuntime && connectedIntent && (
          <Button variant="soft" tone="neutral" onClick={onToggleLocalRuntime}>
            <Icon icon={Brain} size={2} />
            {item.server?.localRuntimeEnabled === false
              ? `Enable local runtime`
              : `Disable local runtime`}
          </Button>
        )}
        {item.server && (
          <Button variant="soft" tone="neutral" onClick={onForget}>
            <Icon icon={Trash2} size={2} /> Forget
          </Button>
        )}
      </SettingsActions>
    </>
  )
}

function ConnectSplitButton({
  onConnect,
}: {
  onConnect: (options: ConnectServerOptions) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: `inline-flex`, gap: 1 }}>
      <Button
        variant="solid"
        tone="accent"
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
        onClick={() => onConnect({ localRuntimeEnabled: true })}
      >
        <Icon icon={Unplug} size={2} /> Connect
      </Button>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger
          render={
            <Button
              variant="solid"
              tone="accent"
              aria-label="Connection options"
              style={{
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
                paddingInline: 8,
              }}
            >
              <Icon icon={ChevronDown} size={2} />
            </Button>
          }
        />
        <Menu.Content side="bottom" align="end">
          <Menu.Item onSelect={() => onConnect({ localRuntimeEnabled: true })}>
            Connect and start local runtime
          </Menu.Item>
          <Menu.Item onSelect={() => onConnect({ localRuntimeEnabled: false })}>
            Connect without local runtime
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  )
}

function ServerKindBadge({
  item,
}: {
  item: AvailableServer
}): React.ReactElement {
  if (item.isCloud) {
    return (
      <Badge tone="info" size={1}>
        <Icon icon={Cloud} size={1} /> Cloud
      </Badge>
    )
  }
  if (item.isLocal) {
    return (
      <Badge tone="neutral" size={1}>
        <Icon icon={Laptop} size={1} /> Local
      </Badge>
    )
  }
  return (
    <Badge tone="neutral" size={1}>
      <Icon icon={Plug} size={1} /> Self-hosted
    </Badge>
  )
}

function runtimeStatusLabel(status: LocalRuntimeStatus): string {
  switch (status) {
    case `disabled`:
      return `disabled`
    case `stopped`:
      return `stopped`
    case `starting`:
      return `starting`
    case `running`:
      return `running`
    case `error`:
      return `error`
  }
}

function cloudStatusDescription(
  state: CloudAgentServersState | null
): string | null {
  if (!state) return null
  if (state.status === `idle`) {
    return `Sign in to Electric Cloud from Account settings to see cloud servers.`
  }
  if (state.status === `loading`) return `Loading Electric Cloud servers...`
  if (state.status === `unauthorized`) {
    return `Electric Cloud sign-in expired. Sign back in from Account settings.`
  }
  if (state.status === `error`) return state.error
  return null
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
        padding: `12px 16px`,
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
      </Stack>
      <Stack direction="row" align="center" justify="between" gap={3}>
        {isDesktop ? (
          <label style={{ display: `flex`, gap: 8, alignItems: `center` }}>
            <input
              type="checkbox"
              checked={localRuntimeEnabled}
              onChange={(event) => setLocalRuntimeEnabled(event.target.checked)}
            />
            <Text size={2}>Start local runtime when connecting</Text>
          </label>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!canSubmit}>
          Add and connect
        </Button>
      </Stack>
    </form>
  )
}
