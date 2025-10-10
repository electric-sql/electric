import { Box, Flex, ScrollArea } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useSidebar } from './Providers/SidebarProvider'
import SidebarFooter from './Sidebar/SidebarFooter'
import SidebarHeader from './Sidebar/SidebarHeader'
import SidebarThreads from './Sidebar/SidebarThreads'

type Props = {
  threadId: string
}

function Sidebar({ threadId }: Props) {
  const { isLeftSidebarOpen, setLeftSidebarOpen } = useSidebar()

  const classes = useClasses()
  const sidebarClassName = mergeClasses(
    classes.sidebar,
    'sidebar',
    isLeftSidebarOpen && classes.sidebarOpen,
    isLeftSidebarOpen && 'sidebarOpen'
  )

  const overlayClasses = useOverlayClasses()
  const overlayClassName = mergeClasses(
    overlayClasses.overlay,
    isLeftSidebarOpen && overlayClasses.overlayOpen
  )

  const closeSidebar = () => {
    setLeftSidebarOpen(false)
  }

  return (
    <>
      <Box className={overlayClassName} onClick={closeSidebar} />
      <Box className={sidebarClassName}>
        <SidebarHeader />
        <ScrollArea className={classes.scrollArea}>
          <Flex direction="column" px="3" py="2">
            <SidebarThreads threadId={threadId} />
          </Flex>
        </ScrollArea>
        <SidebarFooter />
      </Box>
    </>
  )
}

const useClasses = makeStyles({
  sidebar: {
    backgroundColor: 'var(--sidebar-bg) !important',
    borderRight: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    zIndex: 100,
    '--sidebar-width': '280px',
    width: 'var(--sidebar-width)',
    '@media (max-width: 969px)': {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '280px !important',
      transform: 'translateX(-100%)',
      transition: 'transform 0.3s ease-in-out',
      height: '100dvh',
    },
    '@media (min-width: 970px)': {
      position: 'relative',
      transform: 'none',
    },
  },
  sidebarOpen: {
    '@media (max-width: 969px)': {
      transform: 'translateX(0)',
    },
  },
  scrollArea: {
    flexGrow: 1,
  },
})

const useOverlayClasses = makeStyles({
  overlay: {
    '@media (max-width: 969px)': {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 90,
      opacity: 0,
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease-in-out',
    },
  },
  overlayOpen: {
    '@media (max-width: 969px)': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
})

export default Sidebar
