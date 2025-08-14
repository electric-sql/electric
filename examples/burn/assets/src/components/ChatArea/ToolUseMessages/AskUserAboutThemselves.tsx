import type { EventResult } from '../../../types'

import { useLiveQuery, eq, lt } from '@tanstack/react-db'
import { eventCollection, userCollection } from '../../../db/collections'

interface Props {
  event: EventResult
}

function AskUserAboutThemselves({ event }: Props) {
  const insertedAt = event.inserted_at
  const threadId = event.thread_id

  const { question, subject } = event.data.input

  const formattedQuestion =
    question.length > 0
      ? question.charAt(0).toLowerCase() + question.slice(1)
      : question

  // Figure out whether this is the first question asked of this user in
  // this thread. If it is, we prefix the question test with "Hi, ".
  const { data: previousEvents } = useLiveQuery(
    (query) => (
      query
        .from({ event: eventCollection })
        .select(({ event }) => ({
          id: event.id
        }))
        .orderBy(({ event }) => event.inserted_at, 'asc')
        .limit(1)
        .where(({ event }) => eq(event.thread_id, threadId))
        .where(({ event }) => eq(event.type, 'tool_use'))
        .where(({ event }) => lt(event.inserted_at!, insertedAt))
        .fn.where(({ event }) => {
          const { input, name } = event.data

          return name === 'ask_user_about_themselves' && input.subject === subject
        })
    ),
    [insertedAt, subject, threadId]
  )
  const isFirstQuestion = previousEvents.length === 0
  const prefix = isFirstQuestion ? 'Hi ' : ''

  const { data: users } = useLiveQuery(
    (query) =>
      query
        .from({ user: userCollection })
        .where(({ user }) => eq(user.id, subject))
        .select(({ user }) => ({ name: user.name })),
    [subject]
  )
  const subjectUser = users.length > 0 ? users[0] : undefined

  if (!subjectUser || !formattedQuestion) {
    return null
  }

  return (
    <>
      {prefix}
      <span style={{ color: 'rgb(125, 184, 255)' }}>@{subjectUser.name}</span>
      {prefix ? ', ' : ' '}
      {formattedQuestion}
    </>
  )
}

export default AskUserAboutThemselves
