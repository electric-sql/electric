import { useState } from 'react'
import { ChevronDown, Circle, Plus, Trash2 } from 'lucide-react'
import { useServerConnection } from '../hooks/useServerConnection'
import { Button, IconButton, Input, Menu, Stack, Text } from '../ui'
import styles from './ServerPicker.module.css'

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

  let dotColor = `var(--ds-gray-8)`
  if (activeServer && connected) dotColor = `#22c55e`
  else if (activeServer) dotColor = `#ef4444`

  return (
    <Stack p={3} align="center" gap={2} className={styles.bar}>
      <Menu.Root>
        <Menu.Trigger
          render={
            <Button
              variant="ghost"
              tone="neutral"
              size={2}
              className={styles.trigger}
            >
              <span className={styles.triggerLabel}>
                <Circle size={8} fill={dotColor} stroke="none" />
                <Text size={2} weight="bold" truncate>
                  {activeServer?.name ?? `No server`}
                </Text>
              </span>
              <ChevronDown size={14} />
            </Button>
          }
        />
        <Menu.Content side="bottom" align="start">
          {servers.map((server, i) => (
            <Menu.Item
              key={`${server.url}-${i}`}
              onSelect={() => setActiveServer(server)}
            >
              <Circle
                size={8}
                fill={
                  server.url === activeServer?.url
                    ? dotColor
                    : `var(--ds-gray-8)`
                }
                stroke="none"
              />
              <Text size={2}>{server.name}</Text>
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
            </Menu.Item>
          ))}
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
    </Stack>
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
    <Stack direction="column" gap={2} p={3} className={styles.addPanel}>
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
    </Stack>
  )
}
