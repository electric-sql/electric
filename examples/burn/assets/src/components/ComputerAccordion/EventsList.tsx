import { useLiveQuery, eq } from '@tanstack/react-db'
import { Box } from '@radix-ui/themes'
import { makeStyles } from '@griffel/react'
import { extractSearchableText } from '../../utils/extract'
import { eventCollection, userCollection } from '../../db/collections'
import EventItem from './EventItem'
import type { EventResult } from '../../types'

const useStyles = makeStyles({
  eventsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    paddingTop: 'var(--space-1)',
    paddingBottom: 'var(--space-1)',
  },
})

function matchesFilter(
  { data, type, user_name }: EventResult,
  text: string
): boolean {
  if (user_name.toLowerCase().includes(text)) {
    return true
  }

  const type_str =
    type === 'system'
      ? 'system action'
      : type === 'text'
        ? 'text message'
        : type.replace('_', ' ')

  if (type_str.includes(text)) {
    return true
  }

  return extractSearchableText(data).toLowerCase().includes(text)
}

type Props = {
  threadId: string
  filter: string
}

function EventsList({ threadId, filter }: Props) {
  const classes = useStyles()
  const filterText = filter.trim().toLowerCase()

  // XXX could be configurable in the UI with a checkbox
  const filterOutDoNothings = true

  // First filter the events by threadId.
  const { collection: eventResults } = useLiveQuery(
    (query) => (
      query
        .from({ event: eventCollection })
        .innerJoin({ user: userCollection }, ({ event, user }) =>
          eq(user.id, event.user_id)
        )
        .select(({ event, user }) => ({
          data: event.data,
          id: event.id,
          inserted_at: event.inserted_at!,
          thread_id: event.thread_id,
          type: event.type,
          user_id: user.id,
          user_avatar: user.avatar_url,
          user_name: user.name,
          user_type: user.type,
        }))
        .where(({ event }) => eq(event.thread_id, threadId))
        .fn.where(
          ({ event }) => {
            if (!filterOutDoNothings) {
              return true
            }

            return !(
              event.type === 'tool_use' &&
              event.data?.name === 'do_nothing'
            )
          }
        )
    ),
    [filterOutDoNothings, threadId]
  )

  // Then filter by the typeahead filter text.
  const { data: events } = useLiveQuery(
    (query) => {
      const baseQuery = query
        .from({ result: eventResults })
        .orderBy(({ result }) => result.inserted_at, {
          direction: 'asc',
          nulls: 'last',
        })

      return filterText
        ? baseQuery.fn.where(({ result }) => matchesFilter(result, filterText))
        : baseQuery
    },
    [eventResults, filterText]
  )

  return (
    <Box className={classes.eventsList}>
      {events.map((event) => (
        <EventItem key={event.id} event={event} />
      ))}
    </Box>
  )
}

export default EventsList
