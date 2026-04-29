import { useState, useEffect, useCallback } from 'react'
import { Box, Text } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { AgentsCollection } from '../hooks/useChatroom.js'
import { useEntityChatState } from '../hooks/useEntityChatState.js'

/** One component per agent — each calls useEntityChatState (a hook) at the top level */
function AgentWorkingStatus({
  agentsUrl,
  entityUrl,
  agentType,
  onStatus,
}: {
  agentsUrl: string
  entityUrl: string
  agentType: string
  onStatus: (type: string, working: boolean) => void
}) {
  const state = useEntityChatState(agentsUrl, entityUrl)
  const isWorking = state === `working`

  useEffect(() => {
    onStatus(agentType, isWorking)
  }, [agentType, isWorking, onStatus])

  return null
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

  const [workingMap, setWorkingMap] = useState<Record<string, boolean>>({})

  const handleStatus = useCallback((type: string, working: boolean) => {
    setWorkingMap((prev) => {
      if (prev[type] === working) return prev
      return { ...prev, [type]: working }
    })
  }, [])

  const workingNames = Object.entries(workingMap)
    .filter(([, working]) => working)
    .map(([type]) => type)

  if (!hasUserMessages) return null

  return (
    <>
      {(agents as Array<any>).map((agent: any) => (
        <AgentWorkingStatus
          key={agent.url}
          agentsUrl={agentsUrl}
          entityUrl={agent.url}
          agentType={agent.type}
          onStatus={handleStatus}
        />
      ))}
      {workingNames.length > 0 && (
        <Box className="message message-agent" style={{ opacity: 0.6 }}>
          <Text size="1" color="gray">
            {workingNames.length === 1
              ? `${workingNames[0]} is thinking...`
              : `${workingNames.join(`, `)} are thinking...`}
          </Text>
        </Box>
      )}
    </>
  )
}
