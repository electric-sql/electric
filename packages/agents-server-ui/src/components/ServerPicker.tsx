import { useEffect, useState } from 'react'
import {
  Brain,
  ChevronsUpDown,
  Cloud,
  Laptop,
  Plug,
  Server,
  Unplug,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import {
  useAvailableServers,
  type AvailableServer,
} from '../hooks/useAvailableServers'
import { useServerConnection } from '../hooks/useServerConnection'
import {
  prepareCloudAgentServerConnection,
  rescanDiscoveredServers,
  type ConnectServerOptions,
} from '../lib/server-connection'
import { Icon, IconButton, Menu, Text, Tooltip } from '../ui'
import styles from './ServerPicker.module.css'

/** How often to re-probe localhost while the picker menu is open. */
const DISCOVERY_REFRESH_MS = 5000

type ServerStatus = `ok` | `down` | `unset`

/**
 * Footer-anchored server picker tile.
 *
 * Renders a single-line tile showing `[status] [server name] [chevron]`
 * that opens one deduped list of saved, cloud, and local servers.
 */
export function ServerPicker(): React.ReactElement {
  const {
    activeServer,
    connected,
    connection,
    addServer,
    setActiveServer,
    connectServer,
    disconnectServer,
  } = useServerConnection()
  const { servers } = useAvailableServers()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)

  // While the menu is open, re-probe localhost on a 5-second cadence
  // so newly-started agents servers appear without a manual refresh.
  useEffect(() => {
    if (!isDesktop || !menuOpen) return
    let cancelled = false
    const tick = () => {
      void rescanDiscoveredServers().catch(() => {
        // Swallow — main will report errors via state if it cares.
      })
    }
    tick()
    const interval = setInterval(() => {
      if (!cancelled) tick()
    }, DISCOVERY_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isDesktop, menuOpen])

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
      if (!result) return
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

  const status: ServerStatus = !activeServer
    ? `unset`
    : connected ||
        connection?.status === `connecting` ||
        connection?.status === `reconnecting`
      ? `ok`
      : `down`

  return (
    <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
      <Menu.Trigger
        render={
          <button
            type="button"
            className={styles.tile}
            aria-label="Switch server"
          >
            <span className={styles.tileLabel}>
              <span className={styles.tileStatusSlot}>
                <span className={styles.dot} data-state={status} />
              </span>
              <span className={styles.tileName}>
                {activeServer?.name ?? `No server`}
              </span>
            </span>
            <Icon icon={ChevronsUpDown} size={1} />
          </button>
        }
      />
      <Menu.Content side="top" align="start">
        {servers.map((item) => (
          <ServerMenuItem
            key={item.key}
            item={item}
            onSelect={() => {
              if (item.server) setActiveServer(item.server)
              else
                void connectAvailableServer(item, {
                  localRuntimeEnabled: true,
                })
            }}
            onConnect={(options) => {
              void connectAvailableServer(item, options)
            }}
            onDisconnect={() => {
              if (item.server) disconnectServer(item.server.id)
            }}
            isDesktop={isDesktop}
          />
        ))}
        {servers.length > 0 && <Menu.Separator />}
        <Menu.Item
          onSelect={() =>
            navigate({
              to: `/settings/$category`,
              params: { category: `servers` },
            })
          }
        >
          <Icon icon={Server} size={2} />
          <Text size={2}>Servers...</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}

function ServerMenuItem({
  item,
  onSelect,
  onConnect,
  onDisconnect,
  isDesktop,
}: {
  item: AvailableServer
  onSelect: () => void
  onConnect: (options: ConnectServerOptions) => void
  onDisconnect: () => void
  isDesktop: boolean
}): React.ReactElement {
  const isConnected = item.server?.desiredState === `connected`
  const itemStatus: ServerStatus =
    item.status === `connected` ||
    item.status === `connecting` ||
    item.status === `reconnecting`
      ? `ok`
      : item.status === `offline` || item.status === `error`
        ? `down`
        : `unset`

  return (
    <Menu.Item onSelect={onSelect}>
      <span className={styles.menuRow}>
        <span className={styles.dot} data-state={itemStatus} />
        <ServerKindIcon item={item} />
        <Text size={2} className={styles.menuRowName}>
          {item.name}
        </Text>
        {isDesktop &&
          isConnected &&
          item.server?.localRuntimeEnabled !== false && (
            <Tooltip content="Local runtime enabled" side="right">
              <span
                className={styles.runtimeBadge}
                aria-label="Local runtime enabled"
              >
                <Icon icon={Brain} size={1} />
              </span>
            </Tooltip>
          )}
        {isDesktop && (
          <Tooltip
            content={
              isConnected ? `Disconnect ${item.name}` : `Connect ${item.name}`
            }
            side="right"
          >
            <IconButton
              size={1}
              variant="ghost"
              tone="neutral"
              className={styles.connectionBtn}
              data-state={isConnected ? `connected` : `disconnected`}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                if (isConnected) onDisconnect()
                else onConnect({ localRuntimeEnabled: true })
              }}
              aria-label={
                isConnected ? `Disconnect ${item.name}` : `Connect ${item.name}`
              }
            >
              <Icon icon={isConnected ? Plug : Unplug} size={1} />
            </IconButton>
          </Tooltip>
        )}
      </span>
    </Menu.Item>
  )
}

function ServerKindIcon({
  item,
}: {
  item: AvailableServer
}): React.ReactElement {
  const icon = item.isCloud ? Cloud : item.isLocal ? Laptop : Server
  const label = item.isCloud
    ? `Cloud server`
    : item.isLocal
      ? `Local server`
      : `Self-hosted server`
  return (
    <Tooltip content={label} side="right">
      <span className={styles.kindIcon} aria-label={label}>
        <Icon icon={icon} size={1} />
      </span>
    </Tooltip>
  )
}
