import { useLiveQuery, eq, count } from '@tanstack/react-db'
import { factCollection, userCollection } from '../../../db/collections'
import type { EventResult } from '../../../types'

interface Props {
  event: EventResult
}

function ExtractFacts({ event }: Props) {
  const eventId = event.id

  const { data: results } = useLiveQuery(
    (query) =>
      query
        .from({ fact: factCollection })
        .join({ user: userCollection }, ({ fact, user }) =>
          eq(fact.subject_id, user.id)
        )
        .groupBy(({ user }) => user.name)
        .select(({ fact, user }) => ({
          subject: user.name,
          count: count(fact.id),
        }))
        .where(({ fact }) => eq(fact.tool_use_event_id, eventId)),
    [eventId]
  )

  const lastEntry = results.length - 1
  const secondLastEntry = lastEntry - 1

  return (
    <>
      extracted{' '}
      {results.map(({ subject, count }, index) => {
        const [countStr, label] =
          count > 1 ? [`${count}`, 'facts'] : ['a', 'fact']

        const divider =
          index === lastEntry ? '' : index === secondLastEntry ? ' and ' : ', '

        return (
          <span key={subject}>
            {countStr} {label} about{' '}
            <span style={{ color: 'rgb(125, 184, 255)' }}>@{subject}</span>
            {divider}
          </span>
        )
      })}
    </>
  )
}

export default ExtractFacts
