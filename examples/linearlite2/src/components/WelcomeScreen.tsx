import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
  IconButton,
  Tooltip,
  TextField,
} from '@radix-ui/themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { useAuth } from '../hooks/useAuth'
import AboutSection from './AboutSection'
import { makeStyles } from '@griffel/react'

const useClasses = makeStyles({
  welcomeScreen: {
    height: `100vh`,
    width: `100vw`,
    position: `relative`,
  },
  themeToggle: {
    position: `absolute`,
    top: `16px`,
    right: `16px`,
  },
})

export default function WelcomeScreen() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState(``)
  const [error, setError] = useState(``)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const classes = useClasses()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!username.trim()) {
      setError(`Please enter your name`)
      return
    }

    setIsSubmitting(true)
    signIn(username)
    navigate({ to: `/` })
  }

  return (
    <Flex direction="column" className={classes.welcomeScreen}>
      {/* Theme Toggle */}
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

      {/* Main Content */}
      <Flex
        direction="column"
        align="center"
        justify="center"
        p="4"
        flexGrow="1"
      >
        <Box maxWidth="480px" width="100%" p="0 16px">
          <Heading size="6" mb="5" align="center" weight="medium">
            Welcome to Linearlite
          </Heading>

          <form onSubmit={handleSubmit}>
            <Flex direction="column" gap="4" width="100%">
              <TextField.Root
                type="text"
                placeholder="Enter your name"
                value={username}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setUsername(e.target.value)
                  setError(``)
                }}
                disabled={isSubmitting}
                size="3"
              />

              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}

              <Button type="submit" size="3" disabled={isSubmitting}>
                {isSubmitting ? `Entering...` : `Enter`}
              </Button>
            </Flex>
          </form>
        </Box>
        <AboutSection />
      </Flex>
    </Flex>
  )
}
