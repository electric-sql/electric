import { Text } from '@radix-ui/themes'
import { MessagesSquare } from 'lucide-react'
import { makeStyles } from '@griffel/react'

const useThreadHeadingStyles = makeStyles({
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: '1px',
    marginBottom: '-1px',
    boxSizing: 'border-box',
    textAlign: 'center',
    // Medium screens (left sidebar collapsed, right sidebar visible)
    '@media (max-width: 969px)': {
      paddingLeft: 'var(--space-2)',
      paddingRight: 'var(--space-4)',
      justifyContent: 'center',
      width: 'calc(100% - 48px)', // Force width to be less than full to account for hamburger icon
    },
    // Small screens (both sidebars collapsed)
    '@media (max-width: 699px)': {
      paddingLeft: 'var(--space-2)',
      paddingRight: 'var(--space-2) !important',
      width: 'calc(100% - 64px) !important',
      justifyContent: 'center',
    },
  },
  icon: {
    marginRight: 'var(--space-2)',
    flexShrink: 0,
  },
  text: {
    color: 'var(--gray-12)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flexGrow: 0,
  },
})

type ThreadHeadingProps = {
  title: string
}

function ThreadHeading({ title }: ThreadHeadingProps) {
  const classes = useThreadHeadingStyles()

  return (
    <div className={classes.container}>
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <span className={classes.icon}>
            <MessagesSquare size={14} />
          </span>
          <Text size="3" weight="medium" className={classes.text}>
            {title}
          </Text>
        </div>
      </div>
    </div>
  )
}

export default ThreadHeading
