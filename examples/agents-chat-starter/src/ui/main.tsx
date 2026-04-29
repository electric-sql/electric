import { StrictMode, useState, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Theme, Flex, Text, Heading, IconButton } from '@radix-ui/themes'
import { SunIcon, MoonIcon, DesktopIcon } from '@radix-ui/react-icons'
import '@radix-ui/themes/styles.css'
import { useChatroom } from './hooks/useChatroom.js'
import { useEntityTypes } from './hooks/useEntityTypes.js'
import {
  DarkModeProvider,
  useDarkModeContext,
  type ThemePreference,
} from './hooks/useDarkMode.js'
import { RoomsSidebar } from './components/RoomsSidebar.js'
import { ChatArea } from './components/ChatArea.js'
import { MembersSidebar } from './components/MembersSidebar.js'
import './main.css'

function themeButtonIcon(preference: ThemePreference) {
  if (preference === `light`) return <SunIcon />
  if (preference === `dark`) return <MoonIcon />
  return <DesktopIcon />
}

function themeButtonAriaLabel(preference: ThemePreference): string {
  if (preference === `light`) return `Switch to dark mode`
  if (preference === `dark`) return `Switch to system theme`
  return `Switch to light mode`
}

interface Room {
  id: string
  name: string
  agentCount: number
  createdAt: number
}

function getRoomFromHash(): string | null {
  const hash = window.location.hash.slice(1)
  return hash || null
}

function ThemeToggle() {
  const { preference, cyclePreference } = useDarkModeContext()
  return (
    <IconButton
      variant="ghost"
      size="2"
      color="gray"
      onClick={cyclePreference}
      aria-label={themeButtonAriaLabel(preference)}
    >
      {themeButtonIcon(preference)}
    </IconButton>
  )
}

function ThemedApp() {
  const { darkMode } = useDarkModeContext()
  return (
    <Theme
      accentColor="indigo"
      grayColor="mauve"
      radius="medium"
      appearance={darkMode ? `dark` : `light`}
    >
      <App />
    </Theme>
  )
}

function App() {
  const [config, setConfig] = useState<{ agentsUrl: string } | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(
    getRoomFromHash
  )
  const [creating, setCreating] = useState(false)

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null

  useEffect(() => {
    fetch(`/api/config`)
      .then((r) => r.json())
      .then((c) => setConfig(c as { agentsUrl: string }))
      .catch((err) => console.error(`Config failed:`, err))
  }, [])

  const loadRooms = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms`)
      if (res.ok) setRooms((await res.json()) as Room[])
    } catch {}
  }, [])

  useEffect(() => {
    loadRooms()
  }, [loadRooms])

  // Sync active room to URL hash
  useEffect(() => {
    window.location.hash = activeRoomId ?? ``
  }, [activeRoomId])

  // Restore active room on browser back/forward
  useEffect(() => {
    const onHashChange = () => setActiveRoomId(getRoomFromHash())
    window.addEventListener(`hashchange`, onHashChange)
    return () => window.removeEventListener(`hashchange`, onHashChange)
  }, [])

  const createRoom = useCallback(async (name: string) => {
    setCreating(true)
    try {
      const res = await fetch(`/api/rooms`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({ name: name || undefined }),
      })
      if (res.ok) {
        const room = (await res.json()) as Room
        setRooms((prev) => [...prev, room])
        setActiveRoomId(room.id)
      }
    } catch (err) {
      console.error(`Create room failed:`, err)
    } finally {
      setCreating(false)
    }
  }, [])

  const { messagesCollection, agentsCollection, connected, error } =
    useChatroom(config?.agentsUrl ?? null, activeRoomId)
  const entityTypes = useEntityTypes(config?.agentsUrl ?? null)

  const sendMessage = useCallback(
    async (text: string) => {
      if (!activeRoomId) return
      try {
        await fetch(`/api/rooms/${activeRoomId}/message`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({ text }),
        })
      } catch (err) {
        console.error(`Send failed:`, err)
      }
    },
    [activeRoomId]
  )

  const spawnAgent = useCallback(
    async (type: string) => {
      if (!activeRoomId) return
      try {
        await fetch(`/api/rooms/${activeRoomId}/agent`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({ type }),
        })
      } catch (err) {
        console.error(`Spawn failed:`, err)
      }
    },
    [activeRoomId]
  )

  if (!config) {
    return (
      <Flex align="center" justify="center" style={{ height: `100vh` }}>
        <Text size="2" color="gray">
          connecting...
        </Text>
      </Flex>
    )
  }

  return (
    <Flex className="app-layout">
      <RoomsSidebar
        rooms={rooms}
        activeRoomId={activeRoomId}
        onSelectRoom={setActiveRoomId}
        onCreateRoom={createRoom}
        creating={creating}
      />
      <Flex direction="column" flexGrow="1" style={{ minWidth: 0 }}>
        <Flex
          px="3"
          py="3"
          align="center"
          justify="between"
          className="chat-header"
        >
          {activeRoom ? (
            <Heading size="3">
              <Text color="gray"># </Text>
              {activeRoom.name}
            </Heading>
          ) : (
            <Heading size="3" color="gray">
              Chat
            </Heading>
          )}
          <ThemeToggle />
        </Flex>
        <Flex flexGrow="1" style={{ minHeight: 0 }}>
          <ChatArea
            messagesCollection={messagesCollection}
            agentsCollection={agentsCollection}
            agentsUrl={config.agentsUrl}
            connected={connected}
            error={error}
            onSend={sendMessage}
            roomName={activeRoom?.name ?? null}
          />
          <MembersSidebar
            agentsCollection={agentsCollection}
            entityTypes={entityTypes}
            onSpawn={spawnAgent}
            connected={connected}
          />
        </Flex>
      </Flex>
    </Flex>
  )
}

createRoot(document.getElementById(`root`)!).render(
  <StrictMode>
    <DarkModeProvider>
      <ThemedApp />
    </DarkModeProvider>
  </StrictMode>
)
