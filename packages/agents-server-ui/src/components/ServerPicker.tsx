import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { useServerConnection } from '../hooks/useServerConnection'
import {
  loadDesktopState,
  onDesktopStateChanged,
  rescanDiscoveredServers,
  type DiscoveredServer,
} from '../lib/server-connection'
import {
  Button,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Stack,
  Text,
  Tooltip,
} from '../ui'
import styles from './ServerPicker.module.css'

/** How often to re-probe localhost while the picker menu is open. */
const DISCOVERY_REFRESH_MS = 5000

type ServerStatus = `ok` | `down` | `unset`

/**
 * Footer-anchored server picker tile.
 *
 * Renders a single-line tile showing `[● status] [server name] [chevron]`
 * that opens a menu listing the saved servers + an "Add server" entry.
 * Picking "Add server" launches a centered modal dialog with the
 * connection form (instead of an absolute-positioned popover above the
 * tile) so the form has the breathing room it needs even when the
 * sidebar is narrow.
 */
export function ServerPicker(): React.ReactElement {
  const {
    servers,
    activeServer,
    connected,
    setActiveServer,
    addServer,
    removeServer,
  } = useServerConnection()
  const [adding, setAdding] = useState(false)
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

  const handleAddDiscovered = useCallback(
    (entry: DiscoveredServer) => {
      addServer({ name: `localhost:${entry.port}`, url: entry.url })
    },
    [addServer]
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
    : connected
      ? `ok`
      : `down`

  // Dialog is always dismissible. The picker tile already shows
  // "No server" as a valid empty state, and the user can re-open
  // the form any time from the Add server menu item — there's no
  // need to trap them in the modal on first launch.

  return (
    <>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          render={
            <button
              type="button"
              className={styles.tile}
              aria-label="Switch server"
            >
              <span className={styles.tileLabel}>
                <span className={styles.dot} data-state={status} />
                <span className={styles.tileName}>
                  {activeServer?.name ?? `No server`}
                </span>
              </span>
              <ChevronsUpDown size={12} />
            </button>
          }
        />
        <Menu.Content side="top" align="start">
          {servers.map((server, i) => {
            const itemStatus: ServerStatus =
              server.url === activeServer?.url ? status : `unset`
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
                  <Tooltip content={`Remove ${server.name}`} side="right">
                    <IconButton
                      size={1}
                      variant="ghost"
                      tone="neutral"
                      className={styles.removeBtn}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeServer(server.url)
                      }}
                      aria-label={`Remove ${server.name}`}
                    >
                      <Trash2 size={12} />
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
                  onSelect={() => handleAddDiscovered(entry)}
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
          <Menu.Item onSelect={() => setAdding(true)}>
            <Plus size={14} />
            <Text size={2}>Add server</Text>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Dialog.Root open={adding} onOpenChange={setAdding}>
        <Dialog.Content maxWidth={440}>
          <Dialog.Title>Add server</Dialog.Title>
          <Dialog.Description>
            Connect to an Electric Agents server by giving it a label and its
            base URL.
          </Dialog.Description>
          <AddServerForm
            onAdd={(name, url) => {
              addServer({ name, url })
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        </Dialog.Content>
      </Dialog.Root>
    </>
  )
}

function AddServerForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(``)
  const [url, setUrl] = useState(``)
  const trimmedName = name.trim()
  const trimmedUrl = url.trim()
  const canSubmit = trimmedName.length > 0 && trimmedUrl.length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onAdd(trimmedName, trimmedUrl)
  }

  return (
    <form onSubmit={handleSubmit} className={styles.addForm}>
      <Stack direction="column" gap={3}>
        <Field label="Name">
          <Input
            placeholder="e.g. Local Dev"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size={2}
            autoFocus
          />
        </Field>
        <Field label="URL">
          <Input
            placeholder="e.g. http://localhost:4437"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            size={2}
          />
        </Field>
      </Stack>
      <Stack gap={2} justify="end" className={styles.addFormActions}>
        <Button type="button" variant="soft" tone="neutral" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          Add server
        </Button>
      </Stack>
    </form>
  )
}
