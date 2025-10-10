import { useState } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { Box, Flex, Text, Heading, Button, TextField } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import AboutSection from '../components/AboutSection'
import ThemeToggle from '../components/ThemeToggle'
import UserAvatar from '../components/UserAvatar'
import { useGithubAvatar } from '../hooks/useGithubAvatar'
import * as auth from '../db/auth'
import * as api from '../api'

const useClasses = makeStyles({
  fireIcon: {
    position: `relative`,
    display: `block`,
    fontSize: `calc(45px * var(--scaling))`,
    marginBottom: `var(--space-4)`,
  },
  welcomeScreen: {
    minHeight: `100vh`,
    width: `100vw`,
    position: `relative`,
    overflowY: `auto`,
  },
})

function Welcome() {
  const classes = useClasses()
  const navigate = useNavigate()
  const search = useSearch({ from: '/welcome' })

  const [username, setUsername] = useState(``)
  const avatarUrl = useGithubAvatar(username)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState(``)

  const signInUser = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedUserName = username.trim()
    if (!trimmedUserName) {
      setError(`Please enter your name`)

      return
    }

    setIsSubmitting(true)

    const user_id = await api.signIn(trimmedUserName, avatarUrl)

    setIsSubmitting(false)

    if (user_id === undefined) {
      setError(`There was an error. Please try again`)

      return
    }

    await auth.signIn(user_id)

    navigate({ to: search.next ? search.next : '/'})
  }

  return (
    <Flex direction="column" className={classes.welcomeScreen}>
      <ThemeToggle />
      <Flex
        direction="column"
        align="center"
        justify="center"
        p="4"
        flexGrow="1"
      >
        <Box maxWidth="512px" width="100%" p="0 16px">
          <Heading size="6" mb="5" mt="5" align="left" weight="medium">
            <Text className={classes.fireIcon}>🔥</Text>
            Burn
          </Heading>
          <form onSubmit={signInUser}>
            <Flex direction="column" gap="4" width="100%">
              <Box>
                <Text as="label" size="3" weight="medium">
                  Enter your username
                </Text>
                <Box>
                  <Text size="1" color="gray">
                    Using your GitHub username (and pausing for a moment) will
                    pull&nbsp;in your&nbsp;avatar.
                  </Text>
                </Box>
              </Box>
              <Flex direction="row" gap="3" width="100%" align="center">
                {avatarUrl !== undefined && (
                  <UserAvatar
                    username={username}
                    imageUrl={avatarUrl}
                    size="medium"
                    showTooltip={false}
                  />
                )}
                <TextField.Root
                  type="text"
                  placeholder="defunkt"
                  value={username}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setUsername(e.target.value)
                    setError(``)
                  }}
                  disabled={isSubmitting}
                  size="3"
                  style={{ flex: 1 }}
                />
              </Flex>
              {error && (
                <Text color="red" size="2" align="center">
                  {error}
                </Text>
              )}
              <Button
                type="submit"
                size="3"
                color="iris"
                variant="soft"
                disabled={isSubmitting}
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

export const Route = createFileRoute('/welcome')({
  component: Welcome,
  validateSearch: (search: Record<string, unknown>) => ({
    next: (search.next as string) || undefined,
  }),
})
