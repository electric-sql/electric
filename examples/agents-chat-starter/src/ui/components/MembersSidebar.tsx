import { Box, Flex, Text, Heading } from '@radix-ui/themes'
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
  const { data: agents = [] } = useLiveQuery(
    agentsCollection
      ? (q) => q.from({ a: agentsCollection }).select(({ a }) => a)
      : () => null,
    [agentsCollection]
  )

  return (
    <Flex direction="column" className="panel panel-members">
      <Box px="3" py="3">
        <Heading size="3">Members</Heading>
      </Box>

      <Box flexGrow="1" px="2" className="panel-scroll">
        <Box px="1" pb="1">
          <Text size="1" color="gray" weight="medium">
            In this room
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
                  {agent.url}
                </Text>
              </Box>
            </Box>
          </Flex>
        ))}
      </Box>

      {entityTypes.length > 0 && (
        <Box px="2" className="panel-footer">
          <Box px="1" pb="1" pt="2">
            <Text size="1" color="gray" weight="medium">
              Add agent
            </Text>
          </Box>
          {entityTypes.map((et) => (
            <Flex
              key={et.name}
              align="center"
              gap="2"
              px="2"
              py="1"
              className={connected ? `list-row` : ``}
              onClick={() => connected && onSpawn(et.name)}
              style={{ opacity: connected ? 1 : 0.4 }}
            >
              <Text size="1" color="gray" style={{ flexShrink: 0 }}>
                +
              </Text>
              <Text size="2" style={{ textTransform: `capitalize` }}>
                {et.name}
              </Text>
            </Flex>
          ))}
          <Box pb="2" />
        </Box>
      )}
    </Flex>
  )
}
