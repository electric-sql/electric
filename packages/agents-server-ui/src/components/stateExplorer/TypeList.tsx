import { Badge, Box, Flex, Text } from '@radix-ui/themes'
import type { MaterializedState } from '@durable-streams/state'

export function TypeList({
  state,
  selectedType,
  onSelectType,
}: {
  state: MaterializedState
  selectedType: string | null
  onSelectType: (type: string) => void
}) {
  const types = state.types

  return (
    <Flex
      direction="column"
      style={{
        minWidth: `fit-content`,
        borderRight: `1px solid var(--gray-a5)`,
      }}
    >
      {/* Header — matches Events header */}
      <Flex
        align="center"
        gap="2"
        px="3"
        py="1"
        style={{ borderBottom: `1px solid var(--gray-a5)` }}
      >
        <Text
          size="1"
          color="gray"
          weight="medium"
          style={{ textTransform: `uppercase` }}
        >
          Types
        </Text>
        <Badge size="1" variant="soft" color="gray">
          {types.length}
        </Badge>
      </Flex>

      {/* Scrollable list */}
      <Flex
        direction="column"
        gap="1"
        style={{
          flex: 1,
          overflow: `auto`,
          padding: `var(--space-2)`,
        }}
      >
        {types.length === 0 ? (
          <Text size="1" color="gray">
            No types yet
          </Text>
        ) : (
          types.map((type) => {
            const count = state.getType(type).size
            const isSelected = type === selectedType
            return (
              <Box
                key={type}
                onClick={() => onSelectType(type)}
                style={{
                  padding: `var(--space-1) var(--space-2)`,
                  borderRadius: `var(--radius-2)`,
                  cursor: `pointer`,
                  background: isSelected ? `var(--accent-a3)` : `transparent`,
                  color: isSelected ? `var(--accent-11)` : `var(--gray-11)`,
                }}
              >
                <Flex justify="between" align="center" gap="3">
                  <Text size="1" weight={isSelected ? `medium` : `regular`}>
                    {type}
                  </Text>
                  <Text size="1" color="gray">
                    {count}
                  </Text>
                </Flex>
              </Box>
            )
          })
        )}
      </Flex>
    </Flex>
  )
}
