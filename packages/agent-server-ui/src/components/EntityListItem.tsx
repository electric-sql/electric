import { Flex, Text } from '@radix-ui/themes'
import { StatusDot } from './StatusDot'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const GUIDE_COLUMN_WIDTH = 16
const GUIDE_LINE_LEFT = 7
const GUIDE_LINE_COLOR = `var(--gray-a6)`

function TreeGuide({
  hasMoreAtDepth,
}: {
  hasMoreAtDepth: ReadonlyArray<boolean>
}): React.ReactElement {
  const last = hasMoreAtDepth.length - 1
  return (
    <Flex style={{ alignSelf: `stretch`, flexShrink: 0 }}>
      {hasMoreAtDepth.map((hasMore, i) => {
        const isCurrent = i === last
        const drawVertical = isCurrent ? true : hasMore
        const verticalStopsAtMid = isCurrent && !hasMore
        const drawBranch = isCurrent
        return (
          <div
            key={i}
            style={{
              width: GUIDE_COLUMN_WIDTH,
              position: `relative`,
              flexShrink: 0,
            }}
          >
            {drawVertical && (
              <div
                style={{
                  position: `absolute`,
                  left: GUIDE_LINE_LEFT,
                  top: 0,
                  height: verticalStopsAtMid ? `50%` : `100%`,
                  borderLeft: `1px solid ${GUIDE_LINE_COLOR}`,
                }}
              />
            )}
            {drawBranch && (
              <div
                style={{
                  position: `absolute`,
                  left: GUIDE_LINE_LEFT,
                  top: `50%`,
                  width: GUIDE_COLUMN_WIDTH - GUIDE_LINE_LEFT,
                  borderTop: `1px solid ${GUIDE_LINE_COLOR}`,
                }}
              />
            )}
          </div>
        )
      })}
    </Flex>
  )
}

function getDisplayName(entity: ElectricEntity): string | null {
  if (typeof entity.tags.title === `string` && entity.tags.title.length > 0) {
    return entity.tags.title
  }
  return null
}

export function EntityListItem({
  entity,
  selected,
  onSelect,
  hasMoreAtDepth,
}: {
  entity: ElectricEntity
  selected: boolean
  onSelect: () => void
  hasMoreAtDepth?: ReadonlyArray<boolean>
}): React.ReactElement {
  const displayName = getDisplayName(entity)
  const isStopped = entity.status === `stopped`
  const guide = hasMoreAtDepth ?? []

  return (
    <Flex
      align="center"
      gap="2"
      py="2"
      px="2"
      className="entity-list-item"
      style={{
        borderRadius: 6,
        cursor: `pointer`,
        background: selected ? `var(--accent-a3)` : undefined,
        opacity: isStopped ? 0.5 : 1,
        transition: `background 0.1s`,
      }}
      onClick={onSelect}
    >
      {guide.length > 0 && <TreeGuide hasMoreAtDepth={guide} />}
      <StatusDot status={entity.status} />
      <Flex direction="column" gap="2">
        {displayName && (
          <Text size="2" weight="medium">
            {displayName}
          </Text>
        )}
        <Text size="1" color="gray">
          {entity.type}
        </Text>
      </Flex>
    </Flex>
  )
}
