import type { MaterializedState } from '@durable-streams/state'
import { Badge, Box, Stack, Text } from '../../ui'
import styles from './TypeList.module.css'

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
    <Stack direction="column" className={styles.root}>
      <Stack align="center" gap={2} px={3} py={1} className={styles.header}>
        <Text
          size={1}
          tone="muted"
          weight="medium"
          className={styles.headerLabel}
        >
          Types
        </Text>
        <Badge size={1} variant="soft" tone="neutral">
          {types.length}
        </Badge>
      </Stack>

      <Stack direction="column" gap={1} className={styles.list}>
        {types.length === 0 ? (
          <Text size={1} tone="muted">
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
                className={`${styles.item} ${isSelected ? styles.itemSelected : ``}`}
              >
                <Stack justify="between" align="center" gap={3}>
                  <Text size={1} weight={isSelected ? `medium` : `regular`}>
                    {type}
                  </Text>
                  <Text size={1} tone="muted">
                    {count}
                  </Text>
                </Stack>
              </Box>
            )
          })
        )}
      </Stack>
    </Stack>
  )
}
