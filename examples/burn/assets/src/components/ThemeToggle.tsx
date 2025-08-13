import { Box, IconButton, Tooltip } from '@radix-ui/themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../components/Providers/ThemeProvider'
import { makeStyles } from '@griffel/react'

const useClasses = makeStyles({
  themeToggle: {
    position: `absolute`,
    top: `16px`,
    right: `16px`,
  },
})

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const classes = useClasses()

  return (
    <Box className={classes.themeToggle}>
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
    </Box>
  )
}

export default ThemeToggle
