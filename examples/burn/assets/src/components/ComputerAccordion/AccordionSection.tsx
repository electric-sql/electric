import { type ReactNode } from 'react'
import { Box, Flex, Text } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const useStyles = makeStyles({
  header: {
    cursor: 'pointer',
    userSelect: 'none',
    width: '100%',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-3)',
  },
  headerEnabled: {
    '&:hover': {
      backgroundColor: 'var(--gray-3)',
    },
  },
  headerDisabled: {
    cursor: 'not-allowed',
    opacity: 0.5,
  },
  content: {
    paddingLeft: 'var(--space-1)',
    paddingRight: 'var(--space-1)',
    paddingBottom: 'var(--space-2)',
    paddingTop: 'var(--space-2)',
    borderBottom: '1px solid var(--border-color)',
  },
  inner: {
    marginLeft: 'var(--space-1)',
    marginRight: 'var(--space-1)',
  },
})

interface Props {
  title: string
  isOpen: boolean
  isDisabled: boolean
  onToggle: () => void
  children?: ReactNode
}

function AccordionSection({
  title,
  isOpen,
  isDisabled,
  onToggle,
  children,
}: Props) {
  const classes = useStyles()
  const headerClassName = mergeClasses(
    classes.header,
    isDisabled ? classes.headerDisabled : classes.headerEnabled
  )
  const ChevonIcon = isOpen ? ChevronDown : ChevronRight

  return (
    <Box width="100%">
      <Flex
        className={headerClassName}
        onClick={isDisabled ? undefined : onToggle}
      >
        <Text size="2" weight="medium">
          {title}
        </Text>
        {!isDisabled && <ChevonIcon size={14} />}
      </Flex>
      {isOpen && children && (
        <Box className={classes.content}>
          <Box className={classes.inner}>{children}</Box>
        </Box>
      )}
    </Box>
  )
}

export default AccordionSection
