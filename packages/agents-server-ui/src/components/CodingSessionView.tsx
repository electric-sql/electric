import { useCodingSession } from '../hooks/useCodingSession'
import { Stack } from '../ui'
import { CodingSessionTimeline } from './CodingSessionTimeline'
import { MessageInput } from './MessageInput'

export function CodingSessionView({
  baseUrl,
  entityUrl,
  entityStopped,
}: {
  baseUrl: string
  entityUrl: string
  entityStopped: boolean
}): React.ReactElement {
  const { db, events, meta, loading, error } = useCodingSession(
    baseUrl,
    entityUrl
  )

  return (
    <Stack direction="column" grow style={{ minHeight: 0 }}>
      <CodingSessionTimeline
        events={events}
        meta={meta}
        loading={loading}
        error={error}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl}
        disabled={entityStopped}
      />
    </Stack>
  )
}
