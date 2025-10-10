import { Flex, IconButton, Text } from '@radix-ui/themes'
import { X as CloseIcon } from 'lucide-react'
import { makeStyles, mergeClasses } from '@griffel/react'

const useClasses = makeStyles({
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding:
      'calc((var(--space-4) + var(--space-5)) / 2) var(--space-4) var(--space-4) var(--space-4)',
    backgroundColor: 'var(--color-background)',
  },
  title: {
    fontWeight: '500',
  },
  closeButton: {
    flexShrink: 0,
  },
  clickable: {
    cursor: 'pointer',
  },
})

type Props = {
  onClose: () => void
}

function ThreadEditTopBar({ onClose }: Props) {
  const classes = useClasses()

  return (
    <Flex className={classes.container}>
      <Text size="3" className={classes.title}>
        Editing
      </Text>
      <IconButton
        variant="ghost"
        size="1"
        className={mergeClasses('clickable', classes.closeButton)}
        onClick={onClose}
      >
        <CloseIcon size={16} />
      </IconButton>
    </Flex>
  )
}

export default ThreadEditTopBar
