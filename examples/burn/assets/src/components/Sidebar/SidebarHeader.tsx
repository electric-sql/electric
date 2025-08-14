import { useNavigate } from '@tanstack/react-router'
import { Flex, Text, IconButton } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useSidebar } from '../Providers/SidebarProvider'

const useClasses = makeStyles({
  header: {
    height: `56px`,
    borderBottom: `1px solid var(--gray-5)`,
    position: `relative`,
    flexShrink: 0,
  },
  title: {
    paddingLeft: `4px`,
    cursor: `pointer`,
  },
  closeButton: {
    position: `absolute`,
    right: `12px`,
    opacity: 0.8,
    height: `28px`,
    width: `28px`,
  },
})

function SidebarHeader() {
  const classes = useClasses()
  const navigate = useNavigate()
  const { setLeftSidebarOpen } = useSidebar()

  return (
    <Flex p="3" align="center" justify="between" className={classes.header}>
      <Text
        size="3"
        weight="bold"
        className={classes.title}
        onClick={() => navigate({ to: `/` })}
      >
        🔥 Burn
      </Text>
      <IconButton
        size="1"
        variant="ghost"
        className={mergeClasses(classes.closeButton, 'closeButton')}
        onClick={() => setLeftSidebarOpen(false)}
      >
        ✕
      </IconButton>
    </Flex>
  )
}

export default SidebarHeader
