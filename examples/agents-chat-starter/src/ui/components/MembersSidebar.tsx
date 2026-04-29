import { Box, Flex, Text } from '@radix-ui/themes'
import { useLiveQuery } from '@tanstack/react-db'
import type { AgentsCollection } from '../hooks/useChatroom.js'
import type { EntityType } from '../hooks/useEntityTypes.js'

export function MembersSidebar({
  agentsCollection,
  entityTypes,
  onSpawn,
  connected,
}: {
  agentsCollection: AgentsCollection | null
  entityTypes: EntityType[]
  onSpawn: (type: string) => void
  connected: boolean
}) {
  const CHAT_AGENT_TYPES = [`socrates`, `camus`, `simone`]
  const chatAgentTypes = entityTypes.filter((et) =>
    CHAT_AGENT_TYPES.includes(et.name)
  )

  const { data: agents = [] } = useLiveQuery(
    agentsCollection
      ? (q) => q.from({ a: agentsCollection }).select(({ a }) => a)
      : () => null,
    [agentsCollection]
  )

  return (
    <Flex direction="column" className="panel panel-members">
      <Box flexGrow="1" px="2" className="panel-scroll">
        <Box px="1" pb="1" pt="2">
          <Text size="1" color="gray" weight="medium">
            Members
          </Text>
        </Box>
        {!connected && agents.length === 0 && (
          <Box px="2" py="2">
            <Text size="1" color="gray">
              Select a room
            </Text>
          </Box>
        )}
        {connected && agents.length === 0 && (
          <Box px="2" py="2">
            <Text size="1" color="gray">
              Waiting for agents...
            </Text>
          </Box>
        )}
        {agents.map((agent: any) => (
          <Flex
            key={agent.url}
            align="center"
            gap="2"
            px="2"
            py="1"
            className="list-row"
            style={{ opacity: agent.status === `stopped` ? 0.5 : 1 }}
          >
            <Box
              className="status-dot"
              style={{
                background:
                  agent.status === `running`
                    ? `#3b82f6`
                    : agent.status === `idle`
                      ? `#22c55e`
                      : agent.status === `spawning`
                        ? `#eab308`
                        : `#cbd5e1`,
              }}
            />
            <Box style={{ minWidth: 0 }}>
              <Box>
                <Text size="2" weight="medium" truncate>
                  {(agent.url as string).split(`/`).pop()}
                </Text>
              </Box>
            </Box>
          </Flex>
        ))}

        <Box px="1" pb="1" pt="3">
          <Text size="1" color="gray" weight="medium">
            Add agent
          </Text>
        </Box>
        {chatAgentTypes.map((et) => {
          const alreadyInRoom = agents.some(
            (a: any) => (a.type as string) === et.name
          )
          const canAdd = connected && !alreadyInRoom
          return (
            <Flex
              key={et.name}
              align="center"
              gap="2"
              px="2"
              py="1"
              className={canAdd ? `list-row` : ``}
              onClick={() => canAdd && onSpawn(et.name)}
              style={{
                opacity: canAdd ? 1 : 0.4,
                cursor: canAdd ? `pointer` : `default`,
              }}
            >
              <Text size="1" color="gray" style={{ flexShrink: 0 }}>
                {alreadyInRoom ? `✓` : `+`}
              </Text>
              <Text size="2" style={{ textTransform: `capitalize` }}>
                {et.name}
              </Text>
            </Flex>
          )
        })}
      </Box>
    </Flex>
  )
}
