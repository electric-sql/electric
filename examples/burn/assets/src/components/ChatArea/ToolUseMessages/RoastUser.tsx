import type { EventResult } from '../../../types'

import { useLiveQuery, eq } from '@tanstack/react-db'
import { userCollection } from '../../../db/collections'

interface Props {
  event: EventResult
}

function RoastUser({ event }: Props) {
  const { roast, subject } = event.data.input

  const formattedRoast =
    roast.length > 0 ? roast.charAt(0).toLowerCase() + roast.slice(1) : roast

  const { data: users } = useLiveQuery(
    (query) =>
      query
        .from({ user: userCollection })
        .where(({ user }) => eq(user.id, subject))
        .select(({ user }) => ({ name: user.name })),
    [subject]
  )
  const subjectUser = users.length > 0 ? users[0] : undefined

  if (!subjectUser || !formattedRoast) {
    return null
  }

  return (
    <>
      <span style={{ color: 'rgb(125, 184, 255)' }}>@{subjectUser.name}</span>{' '}
      {formattedRoast}
    </>
  )
}

export default RoastUser
