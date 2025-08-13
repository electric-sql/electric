import { useEffect } from 'react'
import { useLiveQuery, eq } from '@tanstack/react-db'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'

import { useAuth } from '../../db/auth'
import { membershipCollection } from '../../db/collections'

function JoinPage() {
  const navigate = useNavigate()

  const { currentUserId, isAuthenticated } = useAuth()
  const { threadId } = useParams({ from: '/join/$threadId' })

  const { data: memberships } = useLiveQuery(
    (query) =>
      query
        .from({ membership: membershipCollection })
        .select(({ membership }) => ({ id: membership.id }))
        .where(({ membership }) => eq(membership.thread_id, threadId))
        .where(({ membership }) => eq(membership.user_id, currentUserId)),
    [threadId, currentUserId]
  )
  const hasMembership = memberships.length > 0

  // If the user isn't in the thread, join them to it.
  useEffect(() => {
    if (isAuthenticated && !hasMembership) {
      const userId = currentUserId as string

      membershipCollection.insert({
        id: crypto.randomUUID(),
        thread_id: threadId,
        user_id: userId,
        role: 'member',
      })

      navigate({ to: `/threads/${threadId}` })
    }
  }, [isAuthenticated, hasMembership, threadId, currentUserId])

  return null
}

export const Route = createFileRoute(`/join/$threadId`)({
  component: JoinPage,
  loader: async () => {
    await membershipCollection.preload()
  },
})
