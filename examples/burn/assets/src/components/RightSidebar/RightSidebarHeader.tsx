import { Flex, Text, IconButton } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useSidebar } from '../Providers/SidebarProvider'
import { Cpu } from 'lucide-react'

const useClasses = makeStyles({
  header: {
    height: `56px`,
    borderBottom: `1px solid var(--gray-5)`,
    position: `relative`,
    flexShrink: 0,
  },
  title: {
    paddingLeft: `4px`,
  },
  icon: {
    marginRight: 'var(--space-2)',
  },
  closeButton: {
    position: `absolute`,
    right: `12px`,
    opacity: 0.8,
    height: `28px`,
    width: `28px`,
  },
})

function RightSidebarHeader() {
  const classes = useClasses()
  const { setRightSidebarOpen } = useSidebar()

  return (
    <Flex p="3" align="center" justify="between" className={classes.header}>
      <IconButton
        size="1"
        variant="ghost"
        className={mergeClasses(classes.closeButton, 'closeButton')}
        onClick={() => setRightSidebarOpen(false)}
      >
        ✕
      </IconButton>
      <Flex align="center" className={classes.title}>
        <span className={classes.icon}>
          <Cpu size={14} />
        </span>
        <Text size="3" weight="medium">
          Computer
        </Text>
      </Flex>
    </Flex>
  )
}

export default RightSidebarHeader
