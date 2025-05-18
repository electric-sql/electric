import { Box, Flex, Text, IconButton, ScrollArea } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import { useMobile } from '../hooks/useMobile'
import { useSidebar } from './SidebarProvider'
import { Menu } from 'lucide-react'

const useClasses = makeStyles({
  scrollArea: {
    height: `100%`,
    width: `100%`,
  },
})

export default function ScreenWithHeader({
  title,
  children,
}: {
  title: string | React.ReactNode
  children: React.ReactNode
}) {
  const { isMobile } = useMobile()
  const { toggleSidebar } = useSidebar()
  const classes = useClasses()
  return (
    <Flex direction="column" width="100%" height="100%">
      {/* Header with menu button */}
      <Box className="chat-header">
        <Flex align="center" gap="2">
          {isMobile && (
            <IconButton variant="ghost" size="1" onClick={toggleSidebar}>
              <Menu size={18} />
            </IconButton>
          )}
          <Text size="3" weight="medium">
            {title}
          </Text>
          {/* TODO: Add a right-aligned section for actions */}
        </Flex>
      </Box>

      <ScrollArea className={classes.scrollArea}>{children}</ScrollArea>
    </Flex>
  )
}
