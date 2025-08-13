import type { ReactNode } from 'react'
import { Button, Text } from '@radix-ui/themes'
import { makeStyles, mergeClasses } from '@griffel/react'

const useClasses = makeStyles({
  button: {
    justifyContent: 'flex-start',
    height: 'auto',
    padding: 'var(--space-2) !important',
    margin: '0 calc(-1 * var(--space-1)) 0 calc(-1 * var(--space-3))',
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
    color: 'var(--gray-12)',
  },
  buttonIcon: {
    marginRight: 'var(--space-1)',
  },
})

type SidebarButtonProps = {
  label?: string
  icon?: ReactNode
  isActive: boolean
  onClick: () => void
  className?: string
}

function SidebarButton({
  label,
  icon,
  isActive,
  onClick,
  className,
}: SidebarButtonProps) {
  const classes = useClasses()
  const buttonClasses = mergeClasses(
    classes.button,
    isActive && classes.buttonActive,
    className
  )

  return (
    <Button
      variant="ghost"
      color="gray"
      size="1"
      my="1"
      mx="1"
      className={buttonClasses}
      onClick={onClick}
    >
      {icon && <span className={classes.buttonIcon}>{icon}</span>}
      {label && (
        <Text size="1" className={classes.buttonText}>
          {label}
        </Text>
      )}
    </Button>
  )
}

export default SidebarButton
