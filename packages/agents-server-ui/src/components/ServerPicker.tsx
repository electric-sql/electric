import { useEffect, useMemo, useState } from 'react'
import { Brain, ChevronsUpDown, Plug, Server, Unplug } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useServerConnection } from '../hooks/useServerConnection'
import {
  loadDesktopState,
  onDesktopStateChanged,
  rescanDiscoveredServers,
  type DiscoveredServer,
} from '../lib/server-connection'
import { Icon, IconButton, Menu, Text, Tooltip } from '../ui'
import styles from './ServerPicker.module.css'

/** How often to re-probe localhost while the picker menu is open. */
const DISCOVERY_REFRESH_MS = 5000

type ServerStatus = `ok` | `down` | `unset`

/**
 * Footer-anchored server picker tile.
 *
 * Renders a single-line tile showing `[● status] [server name] [chevron]`
 * that opens a menu listing saved servers, quick connect controls,
 * discovered localhost hints, and a link to the full Servers settings.
 */
export function ServerPicker(): React.ReactElement {
  const {
    servers,
    activeServer,
    connected,
    connection,
    setActiveServer,
    connectServer,
    disconnectServer,
  } = useServerConnection()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [discovered, setDiscovered] = useState<Array<DiscoveredServer>>([])
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)

  // Mirror the main process's discovered-server set into local state
  // via the same desktop-state broadcast channel the rest of the
  // desktop UI listens on. Web mode never receives a payload here.
  useEffect(() => {
    if (!isDesktop) return
    void loadDesktopState().then((s) => {
      if (s?.discoveredServers) setDiscovered(s.discoveredServers)
    })
    const unsubscribe = onDesktopStateChanged((s) =>
      setDiscovered(s.discoveredServers ?? [])
    )
    return () => {
      unsubscribe?.()
    }
  }, [isDesktop])

  // Hide URLs the user has already saved — the saved-servers list
  // covers them. Sort by port for a stable display order.
  const savedUrls = useMemo(() => new Set(servers.map((s) => s.url)), [servers])
  const newDiscovered = useMemo(
    () =>
      discovered
        .filter((entry) => !savedUrls.has(entry.url))
        .sort((a, b) => a.port - b.port),
    [discovered, savedUrls]
  )

  // While the menu is open, re-probe localhost on a 5-second cadence
  // so newly-started agents servers appear (and stopped ones drop)
  // without a manual refresh button. Background discovery in the
  // main process still runs every 30s when the menu is closed —
  // this loop just tightens the cadence for the moment the user
  // is actively looking at the list. Probe results are broadcast
  // via `desktop:state-changed`, so our existing subscription
  // updates `discovered` automatically; we don't need the return
  // value here.
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
        {servers.map((server, i) => {
          const itemStatus: ServerStatus =
            server.id === activeServer?.id
              ? status
              : server.desiredState === `connected`
                ? `down`
                : `unset`
          const isConnected = server.desiredState === `connected`
          return (
            <Menu.Item
              key={`${server.url}-${i}`}
              onSelect={() => setActiveServer(server)}
            >
              <span className={styles.menuRow}>
                <span className={styles.dot} data-state={itemStatus} />
                <Text size={2} className={styles.menuRowName}>
                  {server.name}
                </Text>
                {isDesktop && server.localRuntimeEnabled !== false && (
                  <Tooltip
                    content="Local runtime enabled for this server"
                    side="right"
                  >
                    <span
                      className={styles.runtimeBadge}
                      aria-label="Local runtime enabled for this server"
                    >
                      <Icon icon={Brain} size={1} />
                    </span>
                  </Tooltip>
                )}
                <Tooltip
                  content={
                    isConnected
                      ? `Disconnect ${server.name}`
                      : `Connect ${server.name}`
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
                      if (isConnected) disconnectServer(server.id)
                      else connectServer(server.id)
                    }}
                    aria-label={
                      isConnected
                        ? `Disconnect ${server.name}`
                        : `Connect ${server.name}`
                    }
                  >
                    <Icon icon={isConnected ? Plug : Unplug} size={1} />
                  </IconButton>
                </Tooltip>
              </span>
            </Menu.Item>
          )
        })}
        {isDesktop && newDiscovered.length > 0 && (
          <>
            {servers.length > 0 && <Menu.Separator />}
            {newDiscovered.map((entry) => (
              <Menu.Item
                key={entry.url}
                onSelect={() => {
                  navigate({
                    to: `/settings/$category`,
                    params: { category: `servers` },
                  })
                }}
              >
                <span className={styles.menuRow}>
                  <span className={styles.dot} data-state="unset" />
                  <Text size={2} className={styles.menuRowName}>
                    localhost:{entry.port}
                  </Text>
                </span>
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Separator />
        <Menu.Item
          onSelect={() =>
            navigate({
              to: `/settings/$category`,
              params: { category: `servers` },
            })
          }
        >
          <Icon icon={Server} size={2} />
          <Text size={2}>Servers…</Text>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  )
}
