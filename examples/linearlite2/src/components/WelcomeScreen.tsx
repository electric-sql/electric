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
} from '@radix-ui/themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { useAuth } from '../hooks/useAuth'
import AboutSection from './AboutSection'

export default function WelcomeScreen() {
  const { signIn } = useAuth()
  const [username, setUsername] = useState(``)
  const [error, setError] = useState(``)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()

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
    <Flex
      direction="column"
      style={{
        height: `100vh`,
        width: `100vw`,
        position: `relative`,
      }}
    >
      {/* Theme Toggle */}
      <Box style={{ position: `absolute`, top: `16px`, right: `16px` }}>
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
        style={{
          flex: 1,
          padding: `16px`,
        }}
      >
        <Box
          style={{
            maxWidth: `480px`,
            width: `100%`,
            padding: `0 16px`,
          }}
        >
          <Heading size="6" mb="5" align="center" weight="medium">
            Welcome to Linearlite
          </Heading>

          <form onSubmit={handleSubmit} style={{ width: `100%` }}>
            <Flex direction="column" gap="4" style={{ width: `100%` }}>
              <input
                type="text"
                placeholder="Enter your name"
                value={username}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setUsername(e.target.value)
                  setError(``)
                }}
                style={{
                  padding: `12px 16px`,
                  fontSize: `16px`,
                  border: `1px solid var(--gray-5)`,
                  borderRadius: `6px`,
                  backgroundColor: `var(--color-background)`,
                  color: `var(--gray-12)`,
                }}
                disabled={isSubmitting}
              />

              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}

              <Button
                type="submit"
                size="3"
                disabled={isSubmitting}
                style={{
                  width: `100%`,
                }}
              >
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
