import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Box,
  Flex,
  Text,
  IconButton,
  ScrollArea,
  Tooltip,
} from '@radix-ui/themes'
import { LogOut, Moon, Sun, Monitor } from 'lucide-react'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useTheme } from './ThemeProvider'
import { useSidebar } from './SidebarProvider'
import UserAvatar from './UserAvatar'
import { useAuth } from '../hooks/useAuth'

const useHeaderClasses = makeStyles({
  header: {
    height: `56px`,
    borderBottom: `1px solid var(--gray-5)`,
    position: `relative`,
    flexShrink: 0,
  },
  title: {
    paddingLeft: `4px`,
  },
  closeButton: {
    position: `absolute`,
    right: `12px`,
    opacity: 0.8,
    height: `28px`,
    width: `28px`,
  },
})

// Header Component
type HeaderProps = {
  isMobile: boolean
  handleNewChat: () => void
  setSidebarOpen: (value: boolean) => void
}

function SidebarHeader({ isMobile, setSidebarOpen }: HeaderProps) {
  const classes = useHeaderClasses()
  return (
    <Flex p="3" align="center" justify="between" className={classes.header}>
      <Text size="3" weight="medium" className={classes.title}>
        Linearlite
      </Text>
      {isMobile && (
        <IconButton
          size="1"
          variant="ghost"
          className={classes.closeButton}
          onClick={() => setSidebarOpen(false)}
        >
          ✕
        </IconButton>
      )}
    </Flex>
  )
}

const useFooterClasses = makeStyles({
  footer: {
    marginTop: `auto`,
    borderTop: `1px solid var(--gray-5)`,
  },
})

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
  const classes = useFooterClasses()
  return (
    <Box p="2" className={classes.footer}>
      <Flex align="center" justify="between" px="2">
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

const useSidebarClasses = makeStyles({
  sidebar: {
    width: `280px`,
    height: `100%`,
  },
  scrollArea: {
    flexGrow: 1,
  },
})

export default function Sidebar() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { username, signOut } = useAuth()
  const { isSidebarOpen, setSidebarOpen } = useSidebar()
  const classes = useSidebarClasses()

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
          className={mergeClasses(`sidebar-overlay`, isSidebarOpen && `open`)}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Box
        className={mergeClasses(
          classes.sidebar,
          `sidebar`,
          isSidebarOpen && `open`
        )}
      >
        {/* Header */}
        <SidebarHeader
          isMobile={isMobile}
          handleNewChat={handleNewChat}
          setSidebarOpen={setSidebarOpen}
        />

        {/* Main Chat List */}
        <ScrollArea className={classes.scrollArea}>
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
