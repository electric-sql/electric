import { useNavigate } from '@tanstack/react-router'
import { useLiveQuery, eq } from '@tanstack/react-db'
import { makeStyles } from '@griffel/react'

import { Button, Flex, Text } from '@radix-ui/themes'
import { Plus, MessagesSquare } from 'lucide-react'

import { useAuth } from '../../db/auth'
import { membershipCollection, threadCollection } from '../../db/collections'
import { createTransaction } from '../../db/transaction'

import SidebarButton from './SidebarButton'

const useClasses = makeStyles({
  threadButton: {
    paddingLeft: '0px',
  },
  threadsContainer: {
    paddingLeft: 'var(--space-2)',
  },
  newThreadButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
})

type Props = {
  threadId: string
}

function SidebarThreads({ threadId }: Props) {
  const { currentUserId } = useAuth()

  const classes = useClasses()
  const navigate = useNavigate()

  const { data: threads } = useLiveQuery(
    (query) =>
      query
        .from({ thread: threadCollection })
        .innerJoin(
          { membership: membershipCollection },
          ({ thread, membership }) => eq(thread.id, membership.thread_id)
        )
        .orderBy(({ thread }) => thread.inserted_at, {
          direction: 'desc',
          nulls: 'first',
        })
        .select(({ thread }) => ({
          id: thread.id,
          name: thread.name,
        }))
        .where(({ membership }) => eq(membership.user_id, currentUserId)),
    [currentUserId]
  )

  const createNewThread = () => {
    const newThreadId = crypto.randomUUID()
    const userId = currentUserId as string
    const numThreads = threads.length

    const tx = createTransaction()
    tx.mutate(() => {
      threadCollection.insert({
        id: newThreadId,
        name: `Untitled thread ${numThreads + 1}`,
        status: 'started',
      })
      membershipCollection.insert({
        id: crypto.randomUUID(),
        role: 'owner',
        thread_id: newThreadId,
        user_id: userId,
      })
    })

    navigateToThread(newThreadId)
  }

  const navigateToThread = (id: string) => {
    navigate({ to: `/threads/${id}` })
  }

  return (
    <>
      <Button
        size="2"
        color="iris"
        variant="soft"
        my="2"
        onClick={createNewThread}
        className={classes.newThreadButton}
      >
        <Plus size={16} /> New thread
      </Button>
      <Flex align="center" py="2" pl="1">
        <Text size="2" weight="medium">
          Threads
        </Text>
      </Flex>
      <Flex direction="column" className={classes.threadsContainer}>
        {threads.map((thread) => (
          <SidebarButton
            key={thread.id}
            label={thread.name}
            icon={<MessagesSquare size={14} />}
            isActive={thread.id === threadId}
            onClick={() => navigateToThread(thread.id)}
            className={classes.threadButton}
          />
        ))}
      </Flex>
    </>
  )
}

export default SidebarThreads
