import { useLiveQuery, eq } from '@tanstack/react-db'
import { useNavigate } from '@tanstack/react-router'
import { makeStyles } from '@griffel/react'
import { Box, Flex, Text, IconButton, Tooltip } from '@radix-ui/themes'
import { LogOut, Moon, Sun, Monitor } from 'lucide-react'
import { signOut as authSignOut, useAuth } from '../../db/auth'
import { userCollection } from '../../db/collections'
import { useTheme } from '../Providers/ThemeProvider'
import UserAvatar from '../UserAvatar'

const useClasses = makeStyles({
  footer: {
    marginTop: `auto`,
    borderTop: `1px solid var(--gray-5)`,
  },
})

function SidebarFooter() {
  const classes = useClasses()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { currentUserId } = useAuth()

  const { data: users } = useLiveQuery(
    (query) =>
      query
        .from({ user: userCollection })
        .select(({ user }) => ({
          name: user.name,
          avatarUrl: user.avatar_url,
        }))
        .where(({ user }) => eq(user.id, currentUserId)),
    [currentUserId]
  )
  const currentUser = users.length > 0 ? users[0] : undefined

  const themeLabel =
    theme === `dark`
      ? `Light mode`
      : theme === `light`
        ? `System mode`
        : `Dark mode`

  const themeComponent =
    theme === `dark` ? (
      <Sun size={14} />
    ) : theme === `light` ? (
      <Monitor size={14} />
    ) : (
      <Moon size={14} />
    )

  const toggleTheme = () => {
    if (theme === `dark`) {
      return setTheme(`light`)
    }

    if (theme === `light`) {
      return setTheme(`system`)
    }

    return setTheme(`dark`)
  }

  function handleLogout() {
    authSignOut()

    navigate({
      to: '/welcome',
      search: { next: undefined },
      reloadDocument: true
    })
  }

  if (currentUser === undefined) {
    return null
  }

  return (
    <Box p="2" className={classes.footer}>
      <Flex align="center" justify="between" px="2">
        <Flex align="center" gap="2">
          <UserAvatar
            username={currentUser.name}
            imageUrl={currentUser.avatarUrl}
            size="small"
            showTooltip={false}
          />
          <Text size="1">{currentUser.name}</Text>
        </Flex>
        <Flex gap="3">
          <Tooltip content={themeLabel}>
            <IconButton size="1" variant="ghost" onClick={toggleTheme}>
              {themeComponent}
            </IconButton>
          </Tooltip>
          <Tooltip content="Log out">
            <IconButton
              size="1"
              variant="ghost"
              color="red"
              onClick={handleLogout}
            >
              <LogOut size={14} />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>
    </Box>
  )
}

export default SidebarFooter
