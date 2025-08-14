import { Box, Flex, ScrollArea } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useSidebar } from './Providers/SidebarProvider'
import RightSidebarHeader from './RightSidebar/RightSidebarHeader'
import ComputerAccordion from './ComputerAccordion'

const useClasses = makeStyles({
  sidebar: {
    backgroundColor: 'var(--sidebar-bg) !important',
    borderLeft: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    zIndex: 100,
    '--sidebar-width': '280px',
    width: 'var(--sidebar-width)',
    '@media (max-width: 699px)': {
      position: 'fixed',
      top: 0,
      right: 0,
      width: '280px !important',
      transform: 'translateX(100%)',
      transition: 'transform 0.3s ease-in-out',
      height: '100dvh',
    },
    '@media (min-width: 700px)': {
      position: 'relative',
      transform: 'none',
    },
  },
  sidebarOpen: {
    '@media (max-width: 699px)': {
      transform: 'translateX(0)',
    },
  },
  scrollArea: {
    flexGrow: 1,
  },
})

const useOverlayClasses = makeStyles({
  overlay: {
    '@media (max-width: 699px)': {
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
    '@media (max-width: 699px)': {
      opacity: 1,
      pointerEvents: 'auto',
    },
  },
})

type Props = {
  threadId: string
}

function RightSidebar({ threadId }: Props) {
  const { isRightSidebarOpen, setRightSidebarOpen } = useSidebar()

  const classes = useClasses()
  const sidebarClassName = mergeClasses(
    classes.sidebar,
    'right-sidebar',
    isRightSidebarOpen && classes.sidebarOpen,
    isRightSidebarOpen && 'sidebarOpen'
  )

  const overlayClasses = useOverlayClasses()
  const overlayClassName = mergeClasses(
    overlayClasses.overlay,
    isRightSidebarOpen && overlayClasses.overlayOpen
  )

  const closeSidebar = () => {
    setRightSidebarOpen(false)
  }

  return (
    <>
      <Box className={overlayClassName} onClick={closeSidebar} />
      <Box className={sidebarClassName}>
        <RightSidebarHeader />
        <ScrollArea className={classes.scrollArea}>
          <Flex direction="column">
            <ComputerAccordion threadId={threadId} />
          </Flex>
        </ScrollArea>
      </Box>
    </>
  )
}

export default RightSidebar
