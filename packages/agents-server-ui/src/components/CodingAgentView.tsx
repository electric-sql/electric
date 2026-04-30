import { Flex } from '@radix-ui/themes'
import { useCodingAgent } from '../hooks/useCodingAgent'
import { CodingAgentTimeline } from './CodingAgentTimeline'
import { MessageInput } from './MessageInput'

export function CodingAgentView({
  baseUrl,
  entityUrl,
  entityStopped,
}: {
  baseUrl: string
  entityUrl: string
  entityStopped: boolean
}): React.ReactElement {
  const { db, meta, runs, events, lifecycle, loading, error } = useCodingAgent(
    baseUrl,
    entityUrl
  )

  return (
    <Flex direction="column" flexGrow="1" style={{ minHeight: 0 }}>
      <CodingAgentTimeline
        meta={meta}
        runs={runs}
        events={events}
        lifecycle={lifecycle}
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
