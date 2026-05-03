import { useState } from 'react'
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react'
import { useServerConnection } from '../hooks/useServerConnection'
import { Button, IconButton, Input, Menu, Stack, Text } from '../ui'
import styles from './ServerPicker.module.css'

type ServerStatus = `ok` | `down` | `unset`

/**
 * Footer-anchored server picker tile (Cursor-style "user" slot).
 *
 * Renders a single-line tile showing `[● status] [server name] [chevron]`
 * that opens a menu listing the saved servers + an "Add server" entry.
 * The "Add server" inline panel pops above the tile so it doesn't push
 * the rest of the footer around.
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
                  <IconButton
                    size={1}
                    variant="ghost"
                    tone="danger"
                    className={styles.removeBtn}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeServer(server.url)
                    }}
                    aria-label={`Remove ${server.name}`}
                  >
                    <Trash2 size={12} />
                  </IconButton>
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

      {adding && (
        <AddServerPanel
          onAdd={(name, url) => {
            addServer({ name, url })
            setAdding(false)
          }}
          onCancel={() => {
            if (servers.length > 0) setAdding(false)
          }}
        />
      )}
    </>
  )
}

function AddServerPanel({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(``)
  const [url, setUrl] = useState(``)
  return (
    <div className={styles.addPanel}>
      <Input
        placeholder="Name (e.g. Local Dev)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        size={2}
      />
      <Input
        placeholder="URL (e.g. http://localhost:4437)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        size={2}
      />
      <Stack gap={2}>
        <Button size={1} onClick={() => name && url && onAdd(name, url)}>
          Add
        </Button>
        <Button size={1} variant="soft" tone="neutral" onClick={onCancel}>
          Cancel
        </Button>
      </Stack>
    </div>
  )
}
