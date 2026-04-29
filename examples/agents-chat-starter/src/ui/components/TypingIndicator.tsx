import { Box, Text } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { AgentsCollection } from '../hooks/useChatroom.js'
import { useEntityChatState } from '../hooks/useEntityChatState.js'

function useWorkingAgents(
  agents: Array<any>,
  agentsUrl: string
): Array<string> {
  const states = agents.map((agent: any) => ({
    type: agent.type as string,
    state: useEntityChatState(agentsUrl, agent.url),
  }))
  return states.filter((s) => s.state === `working`).map((s) => s.type)
}

export function TypingIndicators({
  agentsCollection,
  agentsUrl,
  hasUserMessages,
}: {
  agentsCollection: AgentsCollection | null
  agentsUrl: string
  hasUserMessages: boolean
}) {
  const { data: agents = [] } = useLiveQuery(
    agentsCollection
      ? (q) => q.from({ a: agentsCollection }).select(({ a }) => a)
      : () => null,
    [agentsCollection]
  )

  const workingNames = useWorkingAgents(agents as Array<any>, agentsUrl)

  if (!hasUserMessages || workingNames.length === 0) return null

  const label =
    workingNames.length === 1
      ? `${workingNames[0]} is thinking...`
      : `${workingNames.join(`, `)} are thinking...`

  return (
    <Box className="message message-agent" style={{ opacity: 0.6 }}>
      <Text size="1" color="gray">
        {label}
      </Text>
    </Box>
  )
}
