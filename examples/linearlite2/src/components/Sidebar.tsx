import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Box,
  Flex,
  Text,
  IconButton,
  Button,
  ScrollArea,
  Tooltip,
} from '@radix-ui/themes'
import { LogOut, Moon, Sun, MessageSquarePlus, Monitor } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { useSidebar } from './SidebarProvider'
import UserAvatar from './UserAvatar'
import { useAuth } from '../hooks/useAuth'

// Header Component
type HeaderProps = {
  isMobile: boolean
  handleNewChat: () => void
  setSidebarOpen: (value: boolean) => void
}

function SidebarHeader({
  isMobile,
  handleNewChat,
  setSidebarOpen,
}: HeaderProps) {
  return (
    <Flex
      p="3"
      align="center"
      justify="between"
      style={{
        height: `56px`,
        borderBottom: `1px solid var(--gray-5)`,
        position: `relative`,
        flexShrink: 0,
      }}
    >
      <Text size="3" weight="medium" style={{ paddingLeft: `4px` }}>
        Linearlite
      </Text>
      {!isMobile && (
        <Tooltip content="New Chat">
          <IconButton variant="ghost" size="2" onClick={handleNewChat}>
            <MessageSquarePlus size={22} />
          </IconButton>
        </Tooltip>
      )}
      {isMobile && (
        <IconButton
          size="1"
          variant="ghost"
          style={{
            position: `absolute`,
            right: `12px`,
            opacity: 0.8,
            height: `28px`,
            width: `28px`,
          }}
          onClick={() => setSidebarOpen(false)}
        >
          ✕
        </IconButton>
      )}
    </Flex>
  )
}

// Footer Component
type FooterProps = {
  username: string
  theme: string | undefined
  setTheme: (theme: string) => void
  handleLogout: () => void
}

function SidebarFooter({
  username,
  theme,
  setTheme,
  handleLogout,
}: FooterProps) {
  return (
    <Box
      p="2"
      style={{ marginTop: `auto`, borderTop: `1px solid var(--gray-5)` }}
    >
      <Flex align="center" justify="between" style={{ padding: `0 8px` }}>
        <Flex align="center" gap="2">
          <UserAvatar username={username} size="small" showTooltip={false} />
          <Text size="1">{username}</Text>
        </Flex>
        <Flex gap="3">
          <Tooltip
            content={
              theme === `dark`
                ? `Light mode`
                : theme === `light`
                  ? `System mode`
                  : `Dark mode`
            }
          >
            <IconButton
              size="1"
              variant="ghost"
              onClick={() => {
                if (theme === `dark`) setTheme(`light`)
                else if (theme === `light`) setTheme(`system`)
                else setTheme(`dark`)
              }}
            >
              {theme === `dark` ? (
                <Sun size={14} />
              ) : theme === `light` ? (
                <Monitor size={14} />
              ) : (
                <Moon size={14} />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip content="Log out">
            <IconButton
              size="1"
              variant="ghost"
              color="red"
              onClick={handleLogout}
            >
              <LogOut size={14} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Box>
  )
}

export default function Sidebar() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { username, signOut } = useAuth()
  const { isSidebarOpen, setSidebarOpen } = useSidebar()

  // Set up window resize handler
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (!mobile) {
        setSidebarOpen(false)
      }
    }

    handleResize() // Call immediately
    window.addEventListener(`resize`, handleResize)
    return () => window.removeEventListener(`resize`, handleResize)
  }, [setSidebarOpen])

  const handleNewChat = () => {
    navigate({ to: `/` })
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  return (
    <>
      {/* Sidebar overlay (mobile only) */}
      {isMobile && (
        <Box
          className={`sidebar-overlay ${isSidebarOpen ? `open` : ``}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Box
        className={`sidebar ${isSidebarOpen ? `open` : ``}`}
        style={{
          width: isMobile ? `280px` : `280px`,
          height: `100%`,
        }}
      >
        {/* Header */}
        <SidebarHeader
          isMobile={isMobile}
          handleNewChat={handleNewChat}
          setSidebarOpen={setSidebarOpen}
        />

        {/* Prominent New Chat button for mobile */}
        {isMobile && (
          <Box p="2">
            <Button
              size="1"
              variant="solid"
              style={{
                width: `100%`,
                justifyContent: `center`,
                height: `28px`,
                color: `var(--white)`,
              }}
              onClick={handleNewChat}
            >
              New Chat
            </Button>
          </Box>
        )}

        {/* Main Chat List */}
        <ScrollArea style={{ flexGrow: 1 }}>
          <Flex direction="column" px="3" py="1">
            TODO: Stuff here
          </Flex>
        </ScrollArea>

        {/* Footer */}
        <SidebarFooter
          username={username!}
          theme={theme}
          setTheme={setTheme}
          handleLogout={signOut}
        />
      </Box>
    </>
  )
}
