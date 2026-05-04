import { useCallback, useState } from 'react'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { useServerConnection } from '../hooks/useServerConnection'
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

type ServerStatus = `ok` | `down` | `unset`

/**
 * Footer-anchored server picker tile (Cursor-style "user" slot).
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

  const status: ServerStatus = !activeServer
    ? `unset`
    : connected
      ? `ok`
      : `down`

  // Dismissing the dialog when there is no configured server would leave
  // the app in an unusable state — block it until at least one entry has
  // been added. (`useServerConnection` seeds a fallback "This Server"
  // entry on first load, so this is a defensive guard rather than a
  // common path.)
  const canDismissAdd = servers.length > 0

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && !canDismissAdd) return
      setAdding(open)
    },
    [canDismissAdd]
  )

  return (
    <>
      <Menu.Root>
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
          {servers.length > 0 && <Menu.Separator />}
          <Menu.Item onSelect={() => setAdding(true)}>
            <Plus size={14} />
            <Text size={2}>Add server</Text>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Dialog.Root open={adding} onOpenChange={handleOpenChange}>
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
            canCancel={canDismissAdd}
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
  canCancel,
}: {
  onAdd: (name: string, url: string) => void
  onCancel: () => void
  canCancel: boolean
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
        <Button
          type="button"
          variant="soft"
          tone="neutral"
          onClick={onCancel}
          disabled={!canCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit}>
          Add server
        </Button>
      </Stack>
    </form>
  )
}
