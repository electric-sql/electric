import { Button, DropdownMenu, Flex, IconButton, Text } from '@radix-ui/themes'
import { ChevronDown, Circle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useServerConnection } from '../hooks/useServerConnection'

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

  let dotColor = `var(--gray-8)`
  if (activeServer && connected) dotColor = `#22c55e`
  else if (activeServer) dotColor = `#ef4444`

  return (
    <Flex
      p="3"
      align="center"
      gap="2"
      style={{ borderBottom: `1px solid var(--gray-a5)`, position: `relative` }}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button
            variant="ghost"
            size="2"
            style={{ flex: 1, justifyContent: `flex-start` }}
          >
            <Flex align="center" gap="2" style={{ flex: 1 }}>
              <Circle size={8} fill={dotColor} stroke="none" />
              <Text size="2" weight="bold" truncate>
                {activeServer?.name ?? `No server`}
              </Text>
            </Flex>
            <ChevronDown size={14} />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {servers.map((server, i) => (
            <DropdownMenu.Item
              key={`${server.url}-${i}`}
              onSelect={() => setActiveServer(server)}
            >
              <Flex align="center" gap="2">
                <Circle
                  size={8}
                  fill={
                    server.url === activeServer?.url
                      ? dotColor
                      : `var(--gray-8)`
                  }
                  stroke="none"
                />
                <Text size="2">{server.name}</Text>
                <IconButton
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeServer(server.url)
                  }}
                  aria-label={`Remove ${server.name}`}
                >
                  <Trash2 size={12} />
                </IconButton>
              </Flex>
            </DropdownMenu.Item>
          ))}
          {servers.length > 0 && <DropdownMenu.Separator />}
          <DropdownMenu.Item onSelect={() => setAdding(true)}>
            <Flex align="center" gap="2">
              <Plus size={14} />
              <Text size="2">Add server</Text>
            </Flex>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      {adding && (
        <AddServerDialog
          onAdd={(name, url) => {
            addServer({ name, url })
            setAdding(false)
          }}
          onCancel={() => {
            if (servers.length > 0) setAdding(false)
          }}
        />
      )}
    </Flex>
  )
}

function AddServerDialog({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, url: string) => void
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(``)
  const [url, setUrl] = useState(``)

  return (
    <Flex
      direction="column"
      gap="2"
      p="3"
      style={{
        position: `absolute`,
        top: 48,
        left: 0,
        right: 0,
        zIndex: 10,
        background: `var(--color-background)`,
        borderBottom: `1px solid var(--gray-a5)`,
        boxShadow: `var(--shadow-3)`,
      }}
    >
      <input
        placeholder="Name (e.g. Local Dev)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: `6px 10px`,
          borderRadius: 6,
          border: `1px solid var(--gray-a5)`,
          fontSize: 13,
        }}
      />
      <input
        placeholder="URL (e.g. http://localhost:4437)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{
          padding: `6px 10px`,
          borderRadius: 6,
          border: `1px solid var(--gray-a5)`,
          fontSize: 13,
        }}
      />
      <Flex gap="2">
        <Button size="1" onClick={() => name && url && onAdd(name, url)}>
          Add
        </Button>
        <Button size="1" variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
      </Flex>
    </Flex>
  )
}
