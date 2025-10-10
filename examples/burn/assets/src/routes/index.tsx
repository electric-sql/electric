import { useEffect } from 'react'
import { useLiveQuery, eq } from '@tanstack/react-db'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '../db/auth'
import { membershipCollection, threadCollection } from '../db/collections'

// The index page always redirects to the user's latest thread.
function Index() {
  const navigate = useNavigate()
  const { currentUserId, isAuthenticated } = useAuth()

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
        .limit(1)
        .select(({ thread }) => ({ id: thread.id }))
        .where(({ membership }) => eq(membership.user_id, currentUserId)),
    [currentUserId]
  )
  const latestThreadId = threads.length > 0 ? threads[0].id : undefined

  useEffect(() => {
    if (!isAuthenticated || latestThreadId === undefined) {
      return
    }

    navigate({ to: '/threads/$threadId', params: { threadId: latestThreadId } })
  }, [isAuthenticated, latestThreadId, navigate])

  return null
}

export const Route = createFileRoute(`/`)({
  component: Index,
  loader: async () => {
    await Promise.all([
      membershipCollection.preload(),
      threadCollection.preload(),
    ])
  },
})
