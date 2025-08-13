import { useState } from 'react'
import { useLiveQuery, eq, not } from '@tanstack/react-db'
import { Box, Flex, Text, TextField, Button, IconButton } from '@radix-ui/themes'
import { X as CloseIcon } from 'lucide-react'
import { makeStyles, mergeClasses } from '@griffel/react'
import { useAuth } from '../../db/auth'
import { copyInviteLink, getJoinUrl } from '../../utils/clipboard'
import UserAvatar from '../UserAvatar'
import ThreadRemoveUserModal from './ThreadRemoveUserModal'

import { membershipCollection, threadCollection, userCollection } from '../../db/collections'
import type { Membership, User } from '../../db/schema'

const useClasses = makeStyles({
  listItem: {
    borderRadius: 'var(--radius-2)',
    padding: 'var(--space-2)',
    marginLeft: 'calc(-1 * var(--space-2))',
    marginRight: 'calc(-1 * var(--space-2))',
    transition: 'background-color 0.15s ease',
  },
  clickableRow: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: 'var(--gray-3)',
    },
  },
})

type UserResult = Pick<
  User,
  | 'id'
  | 'name'
  | 'avatar_url'
> & {
  membership_id: Membership['id'],
  membership_role: Membership['role']
}

type Props = {
  threadId: string
}

function ThreadEditForm({ threadId }: Props) {
  const classes = useClasses()
  const { currentUserId } = useAuth()

  // Get the current thread.

  const { data: threads } = useLiveQuery(
    (query) =>
      query
        .from({ thread: threadCollection })
        .where(({ thread }) => eq(thread.id, threadId)),
    [threadId]
  )
  const thread = threads[0]!

  const [threadName, setThreadName] = useState(thread.name)
  const [threadNameSaved, setThreadNameSaved] = useState(false)
  const [showRemoveModal, setShowRemoveModal] = useState(false)
  const [userToRemove, setUserToRemove] = useState<UserResult | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)

  // All the users and agents in the thread.

  const { collection: memberResults } = useLiveQuery(
    (query) => (
      query
        .from({ user: userCollection })
        .innerJoin(
          { membership: membershipCollection },
          ({ user, membership }) => eq(user.id, membership.user_id)
        )
        .select(({ user, membership }) => ({
          id: user.id,
          name: user.name,
          type: user.type,
          avatar_url: user.avatar_url,
          membership_id: membership.id,
          membership_role: membership.role,
        }))
        .where(({ membership }) => eq(membership.thread_id, threadId))
    ),
    [threadId]
  )

  // Just the humans.

  const { collection: userResults } = useLiveQuery(
    (query) => (
      query
        .from({ result: memberResults })
        .where(({ result }) => eq(result.type, 'human'))
    ),
    [memberResults]
  )
  const { data: ownerUsers } = useLiveQuery(
    (query) => (
      query
        .from({ result: userResults })
        .where(({ result }) => eq(result.membership_role, 'owner'))
    ),
    [userResults]
  )
  const { data: currentUsers } = useLiveQuery(
    (query) => (
      query
        .from({ result: userResults })
        .where(({ result }) => eq(result.id, currentUserId))
    ),
    [userResults, currentUserId]
  )
  const { data: otherUsers } = useLiveQuery(
    (query) => (
      query
        .from({ result: userResults })
        .orderBy(({ result }) => result.name, 'asc')
        .where(({ result }) => not(eq(result.id, currentUserId)))
    ),
    [userResults, currentUserId]
  )
  const currentUser = currentUsers[0]!
  const threadUsers = [currentUser, ...otherUsers]

  const ownerUser = ownerUsers[0]!
  const isOwner = currentUser.id === ownerUser.id

  // Just the agents.

  const { collection: agentResults } = useLiveQuery(
    (query) => (
      query
        .from({ result: memberResults })
        .where(({ result }) => eq(result.type, 'agent'))
    ),
    [memberResults]
  )
  const { data: producers } = useLiveQuery(
    (query) => (
      query
        .from({ result: agentResults })
        .orderBy(({ result }) => result.name, 'asc')
        .where(({ result }) => eq(result.membership_role, 'producer'))
    ),
    [agentResults]
  )
  const { data: comedians } = useLiveQuery(
    (query) => (
      query
        .from({ result: agentResults })
        .orderBy(({ result }) => result.name, 'asc')
        .where(({ result }) => eq(result.membership_role, 'comedian'))
    ),
    [agentResults]
  )
  const threadAgents = [...producers, ...comedians]

  const handleSaveThreadName = (e: React.FormEvent) => {
    e.preventDefault()

    threadCollection.update(threadId, (draft) => {
      draft.name = threadName
    })

    setThreadNameSaved(true)
    setTimeout(() => setThreadNameSaved(false), 2000)
  }

  const handleRemoveUser = (user: UserResult) => {
    setUserToRemove(user)

    setShowRemoveModal(true)
  }

  const confirmRemoveUser = () => {
    if (userToRemove) {
      membershipCollection.delete(userToRemove.membership_id)
    }

    setShowRemoveModal(false)
    setUserToRemove(null)
  }

  const cancelRemoveUser = () => {
    setShowRemoveModal(false)

    setUserToRemove(null)
  }

  const handleUserRowClick = (user: UserResult) => {
    if (user.id !== currentUserId) {
      handleRemoveUser(user)
    }
  }

  const handleCopyInvite = () => {
    copyInviteLink(threadId)

    setInviteCopied(true)

    setTimeout(() => setInviteCopied(false), 2000)
  }

  return (
    <>
      <Box p="4" pt="0" height="100%" style={{ overflowY: 'auto' }}>
        {/* Edit thread name */}
        <Box mb="6">
          <form onSubmit={handleSaveThreadName}>
            <Box mb="1">
              <Text as="label" size="2" weight="medium">
                Thread name
              </Text>
            </Box>
            <Flex gap="3" align="end">
              <Box flexGrow="1">
                <TextField.Root
                  value={threadName}
                  size="2"
                  onChange={(e) => setThreadName(e.target.value)}
                />
              </Box>
              <Button type="submit" size="2" color="iris" variant="soft">
                {threadNameSaved ? 'Saved!' : 'Save'}
              </Button>
            </Flex>
          </form>
        </Box>
        {/* Manage users */}
        <Box mb="5">
          <Box mb="2">
            <Text size="3" weight="medium">
              Users
            </Text>
          </Box>
          <Flex direction="column">
            {threadUsers.map((user, index) => (
              <Flex
                align="center"
                justify="between"
                pb="1"
                className={mergeClasses(
                  classes.listItem,
                  index !== 0 && classes.clickableRow
                )}
                key={user.name}
                onClick={() => handleUserRowClick(user)}
              >
                <Flex align="center" gap="2">
                  <UserAvatar username={user.name} imageUrl={user.avatar_url} size="medium" />
                  <Text size="2">{user.name}</Text>
                  {index === 0 && (
                    <Text size="1" color="gray">
                      (you)
                    </Text>
                  )}
                </Flex>
                {index !== 0 && isOwner && (
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveUser(user)
                    }}
                  >
                    <CloseIcon size={14} />
                  </IconButton>
                )}
              </Flex>
            ))}
          </Flex>
          <Box mt="1">
            <Box mb="1">
              <Text as="label" size="2" weight="medium">
                Invite
              </Text>
            </Box>
            <Flex gap="3" align="end">
              <Box flexGrow="1">
                <TextField.Root
                  size="2"
                  value={getJoinUrl(threadId)}
                  readOnly
                />
              </Box>
              <Button
                size="2"
                color="iris"
                variant="soft"
                onClick={handleCopyInvite}
              >
                {inviteCopied ? 'Copied!' : 'Copy'}
              </Button>
            </Flex>
          </Box>
        </Box>
        <Box>
          <Box mb="2">
            <Text size="3" weight="medium">
              Agents
            </Text>
          </Box>
          <Flex direction="column">
            {threadAgents.map((agent, index) => (
              <Flex
                align="center"
                justify="between"
                pb="1"
                className={mergeClasses(
                  classes.listItem,
                  index !== 0 && classes.clickableRow
                )}
                key={agent.name}
                onClick={() => handleUserRowClick(agent)}
              >
                <Flex align="center" gap="2">
                  <UserAvatar username={agent.name} imageUrl={agent.avatar_url} size="medium" />
                  <Text size="2">{agent.name}</Text>
                  <Text size="1" color="gray">
                    ({agent.membership_role})
                  </Text>
                </Flex>
                {agent.membership_role !== 'producer' && isOwner && (
                  <IconButton
                    variant="ghost"
                    size="1"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveUser(agent)
                    }}
                  >
                    <CloseIcon size={14} />
                  </IconButton>
                )}
              </Flex>
            ))}
          </Flex>
        </Box>
      </Box>
      <ThreadRemoveUserModal
        isOpen={showRemoveModal}
        userName={userToRemove?.name || ''}
        onConfirm={confirmRemoveUser}
        onCancel={cancelRemoveUser}
      />
    </>
  )
}

export default ThreadEditForm
