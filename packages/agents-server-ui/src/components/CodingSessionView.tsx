import { Flex } from '@radix-ui/themes'
import { useCodingSession } from '../hooks/useCodingSession'
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
    <Flex direction="column" flexGrow="1" style={{ minHeight: 0 }}>
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
    </Flex>
  )
}
