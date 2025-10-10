import { useLiveQuery, eq } from '@tanstack/react-db'
import { Box } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import { factCollection, userCollection } from '../../db/collections'
import FactItem from './FactItem'
import type { FactResult } from '../../types'

const useStyles = makeStyles({
  factsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    paddingTop: 'var(--space-1)',
    paddingBottom: 'var(--space-1)',
  },
})

function matchesFilter(
  { subject, predicate, object }: FactResult,
  text: string
): boolean {
  return (
    subject.toLowerCase().includes(text) ||
    predicate.toLowerCase().includes(text) ||
    object.toLowerCase().includes(text)
  )
}

type Props = {
  threadId: string
  filter: string
}

function FactsList({ threadId, filter }: Props) {
  const classes = useStyles()
  const filterText = filter.trim().toLowerCase()

  // First filter the facts by threadId,
  // joining to users to get the subject name.
  const { collection: factResults } = useLiveQuery(
    (query) =>
      query
        .from({ fact: factCollection })
        .innerJoin({ user: userCollection }, ({ fact, user }) =>
          eq(fact.subject_id, user.id)
        )
        .select(({ fact, user }) => ({
          id: fact.id,
          subject: user.name,
          predicate: fact.predicate,
          object: fact.object,
          category: fact.category,
          confidence: fact.confidence,
          disputed: fact.disputed,
          inserted_at: fact.inserted_at!,
        }))
        .where(({ fact }) => eq(fact.thread_id, threadId)),
    [threadId]
  )

  // Then filter by the typeahead filter text.
  const { data: facts } = useLiveQuery(
    (query) => {
      const baseQuery = query
        .from({ result: factResults })
        .orderBy(({ result }) => result.inserted_at, {
          direction: 'asc',
          nulls: 'last',
        })

      return filterText
        ? baseQuery.fn.where(({ result }) => matchesFilter(result, filterText))
        : baseQuery
    },
    [factResults, filterText]
  )

  return (
    <Box className={classes.factsList}>
      {facts.map((fact) => (
        <FactItem key={fact.id} fact={fact} />
      ))}
    </Box>
  )
}

export default FactsList
