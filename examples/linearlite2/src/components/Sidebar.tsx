import { useState, useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Box,
  Flex,
  Text,
  IconButton,
  ScrollArea,
  Tooltip,
  Button,
} from '@radix-ui/themes'
import {
  LogOut,
  Moon,
  Sun,
  Monitor,
  Layers,
  CircleDashed,
  SquareKanban,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
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
          <Flex direction="column" px="3" py="2">
            <ProjectSection expanded={true} />
            <ChatsSection />
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

const useProjectSectionClasses = makeStyles({
  projectButton: {
    paddingLeft: '26px',
  },
})

interface ProjectSectionProps {
  expanded?: boolean
}

function ProjectSection({ expanded = false }: ProjectSectionProps) {
  const classes = useProjectSectionClasses()
  const [isExpanded, setIsExpanded] = useState(expanded)
  return (
    <>
      <SidebarButton
        label="My Project"
        isActive={false}
        onClick={() => setIsExpanded(!isExpanded)}
        icon={
          isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        }
      />
      {isExpanded && (
        <>
          <SidebarButton
            label="All Issues"
            isActive={false}
            onClick={() => {}}
            icon={<Layers size={14} />}
            className={classes.projectButton}
          />
          <SidebarButton
            label="Active"
            isActive={false}
            onClick={() => {}}
            icon={<ActiveButtonLine />}
            className={classes.projectButton}
          />
          <SidebarButton
            label="Backlog"
            isActive={false}
            onClick={() => {}}
            icon={<CircleDashed size={14} />}
            className={classes.projectButton}
          />
          <SidebarButton
            label="Board"
            isActive={false}
            onClick={() => {}}
            icon={<SquareKanban size={14} />}
            className={classes.projectButton}
          />
        </>
      )}
    </>
  )
}

const useChatsSectionClasses = makeStyles({
  chatsButton: {
    paddingLeft: '26px',
  },
})

function ChatsSection() {
  const classes = useChatsSectionClasses()
  const [isExpanded, setIsExpanded] = useState(true)
  return (
    <>
      <SidebarButton
        label="Chats"
        isActive={false}
        onClick={() => setIsExpanded(!isExpanded)}
        icon={
          isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
        }
      />
      {isExpanded && (
        <>
          <SidebarButton
            label="This is a conversation"
            isActive={false}
            onClick={() => {}}
            className={classes.chatsButton}
          />
          <SidebarButton
            label="This is a conversation with a very long title"
            isActive={false}
            onClick={() => {}}
            className={classes.chatsButton}
          />
          <SidebarButton
            label="This is a conversation"
            isActive={false}
            onClick={() => {}}
            className={classes.chatsButton}
          />
        </>
      )}
    </>
  )
}

const useSidebarButtonClasses = makeStyles({
  button: {
    justifyContent: 'flex-start',
    height: '22px',
    overflow: 'hidden',
    color: 'var(--black)',
  },
  buttonActive: {
    backgroundColor: 'var(--gray-5)',
  },
  buttonText: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
})

type SidebarButtonProps = {
  label: string
  isActive: boolean
  onClick: () => void
  icon?: React.ReactNode
  className?: string
}

function SidebarButton({
  label,
  isActive,
  onClick,
  icon,
  className,
}: SidebarButtonProps) {
  const classes = useSidebarButtonClasses()
  return (
    <Button
      variant="ghost"
      color="gray"
      size="1"
      my="1"
      mx="1"
      className={mergeClasses(
        classes.button,
        isActive && classes.buttonActive,
        className
      )}
      onClick={onClick}
    >
      {icon}
      <Text size="1" className={classes.buttonText}>
        {label}
      </Text>
    </Button>
  )
}

const useActiveButtonLineClasses = makeStyles({
  line: {
    position: 'relative',
    height: '120%',
    width: '1px',
    margin: '0 7px 0 6px',
    backgroundColor: 'var(--gray-5)',
  },
})

function ActiveButtonLine() {
  const classes = useActiveButtonLineClasses()
  return <div className={classes.line} />
}
