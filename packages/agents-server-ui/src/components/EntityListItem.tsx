import { Flex, Text } from '@radix-ui/themes'
import { StatusDot } from './StatusDot'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const NOISE_TAGS = new Set([`swarm_id`, `source`, `parent`])
const SPAWN_ARG_TITLE_KEYS = [
  `prompt`,
  `task`,
  `topic`,
  `corpus`,
  `description`,
  `message`,
  `title`,
  `cwd`,
]
const SLUG_PREVIEW_MAX = 12

export function getEntityDisplayTitle(entity: ElectricEntity): {
  title: string
  isFromSlug: boolean
} {
  const slug = entity.url.split(`/`).pop() ?? entity.url
  const tagTitle = entity.tags.title
  if (typeof tagTitle === `string` && tagTitle.length > 0) {
    return { title: tagTitle, isFromSlug: false }
  }
  for (const [key, value] of Object.entries(entity.tags)) {
    if (NOISE_TAGS.has(key)) continue
    if (typeof value === `string` && value.length > 0) {
      return { title: value, isFromSlug: false }
    }
  }
  for (const key of SPAWN_ARG_TITLE_KEYS) {
    const v = entity.spawn_args[key]
    if (typeof v === `string` && v.length > 0) {
      return { title: v.slice(0, 80), isFromSlug: false }
    }
  }
  return { title: slug, isFromSlug: true }
}

function formatRelativeTime(updatedAt: number): string {
  const ms = updatedAt < 1e12 ? updatedAt * 1000 : updatedAt
  const diff = Date.now() - ms
  if (diff < 5_000) return `just now`
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo ago`
  const year = Math.floor(day / 365)
  return `${year}y ago`
}

function shortenSlug(slug: string): string {
  if (slug.length <= SLUG_PREVIEW_MAX) return slug
  return `${slug.slice(0, SLUG_PREVIEW_MAX)}…`
}

const GUIDE_COLUMN_WIDTH = 16
const GUIDE_LINE_LEFT = 7
const GUIDE_LINE_COLOR = `var(--gray-a6)`
// Each EntityListItem row uses py="2" (Radix space-2 = 8px) of vertical
// padding. The TreeGuide flex item only stretches to the row's content
// box (excluding padding), which leaves visible gaps in the vertical
// line between adjacent rows. Extending the line `top` and `height` by
// the row's padding bridges those gaps.
const GUIDE_ROW_PADDING_Y = 8

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
                  top: -GUIDE_ROW_PADDING_Y,
                  height: verticalStopsAtMid
                    ? `calc(50% + ${GUIDE_ROW_PADDING_Y}px)`
                    : `calc(100% + ${GUIDE_ROW_PADDING_Y * 2}px)`,
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
  const { title, isFromSlug } = getEntityDisplayTitle(entity)
  const slug = entity.url.split(`/`).pop() ?? entity.url
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
      <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
        <Text
          size="2"
          weight="medium"
          style={{
            whiteSpace: `nowrap`,
            overflow: `hidden`,
            textOverflow: `ellipsis`,
          }}
          title={title}
        >
          {title}
        </Text>
        <Flex
          align="center"
          gap="1"
          style={{ minWidth: 0, color: `var(--gray-11)` }}
        >
          <Text size="1" color="gray">
            {entity.type}
          </Text>
          <Text size="1" color="gray">
            ·
          </Text>
          <Text size="1" color="gray">
            {formatRelativeTime(entity.updated_at)}
          </Text>
          {!isFromSlug && (
            <>
              <Text size="1" color="gray">
                ·
              </Text>
              <Text
                size="1"
                color="gray"
                style={{
                  fontFamily: `var(--font-mono, ui-monospace, monospace)`,
                  opacity: 0.7,
                }}
                title={slug}
              >
                {shortenSlug(slug)}
              </Text>
            </>
          )}
        </Flex>
      </Flex>
    </Flex>
  )
}
