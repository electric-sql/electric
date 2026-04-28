import { Box, Text } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { AgentsCollection } from '../hooks/useChatroom.js'
import { useEntityChatState } from '../hooks/useEntityChatState.js'

/**
 * Renders a typing indicator for a single agent entity.
 * Uses useChat internally to detect `working` state.
 */
function AgentTypingStatus({
  agentsUrl,
  entityUrl,
  agentType,
}: {
  agentsUrl: string
  entityUrl: string
  agentType: string
}) {
  const state = useEntityChatState(agentsUrl, entityUrl)

  if (state !== `working`) return null

  return (
    <Box className="message message-agent" style={{ opacity: 0.6 }}>
      <Text size="1" color="gray">
        {agentType} thinking...
      </Text>
    </Box>
  )
}

/**
 * Renders typing indicators for all agents in a room that are
 * actively generating (chat.state === 'working').
 */
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

  if (!hasUserMessages) return null

  return (
    <>
      {agents.map((agent: any) => (
        <AgentTypingStatus
          key={agent.url}
          agentsUrl={agentsUrl}
          entityUrl={agent.url}
          agentType={agent.type}
        />
      ))}
    </>
  )
}
