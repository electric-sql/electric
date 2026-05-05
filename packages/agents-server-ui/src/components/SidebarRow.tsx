import { memo } from 'react'
import { ChevronDown, ChevronRight, Pin } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { StatusDot } from './StatusDot'
import { HoverCard, Text } from '../ui'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { formatAbsoluteDateTime, formatRelativeTime } from '../lib/formatTime'
import styles from './SidebarRow.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const INDENT_PX = 12
// 3px so the pin button (filling the 22px iconSlot via inset:0) sits
// inside a uniform 3px halo on top, bottom and left, concentric with
// the row's 7px border-radius. See `.row` in SidebarRow.module.css.
const BASE_PADDING_LEFT = 3

/**
 * Payload sent into the shared `<HoverCard.Root>` rendered by
 * `<Sidebar>`. The Root reads this to decide what info to show in the
 * info popout for the currently-hovered row.
 */
export type SidebarRowInfoPayload = {
  entity: ElectricEntity
  title: string
  sessionId: string
  childCount: number
}

type HoverCardHandle = ReturnType<
  typeof HoverCard.useHandle<SidebarRowInfoPayload>
>

type SidebarRowProps = {
  entity: ElectricEntity
  selected: boolean
  depth?: number
  /** Number of immediate children. 0 means no expand affordance. */
  childCount?: number
  expanded?: boolean
  onToggleExpand?: () => void
  pinned?: boolean
  onTogglePin?: () => void
  /**
   * Shared HoverCard handle owned by `<Sidebar>`. All rows attach to
   * the same handle so once one info popout is visible, hovering
   * another row swaps the popup over with no open delay.
   */
  hoverHandle: HoverCardHandle
}

/**
 * One row in the sidebar tree.
 *
 * Layout (single line, fixed `--ds-row-height-md` tall):
 *
 *   [icon-slot 22px]  [title (truncated)]  [type +N]
 *
 * The icon-slot shows the status dot by default, and swaps to a
 * pin/unpin button on row hover (or stays as the pin glyph when the
 * row is already pinned).
 *
 * For collapsed subtrees the child count is rendered inline as plain
 * text right after the type (e.g. `horton +2`). On row hover an
 * expand chevron is overlaid on top of the text on the right; the
 * text fades to transparent just before the chevron via a CSS mask
 * so the glyph doesn't visually clash with the characters underneath.
 * Expanded subtrees show a permanent chevron-down with the count
 * dropped (since the children are visible right below).
 *
 * Wrapped in a HoverCard that pops out a small info card to the right
 * with the full title and session id.
 */
// Memoised so re-renders triggered higher up the tree (sidebar
// re-renders on selection / pin changes) don't cascade into every
// row. Identity-stable callbacks (selection / pin / expand) are the
// caller's responsibility — see `SidebarTree.tsx` for how
// per-row functional state is sourced from external stores.
export const SidebarRow = memo(function SidebarRow({
  entity,
  selected,
  depth = 0,
  childCount = 0,
  expanded = false,
  onToggleExpand,
  pinned = false,
  onTogglePin,
  hoverHandle,
}: SidebarRowProps): React.ReactElement {
  const { title } = getEntityDisplayTitle(entity)
  const isStopped = entity.status === `stopped`
  const hasChildren = childCount > 0
  const sessionId = entity.url.replace(/^\//, ``)
  const className = [
    styles.row,
    selected ? styles.selected : null,
    isStopped ? styles.stopped : null,
  ]
    .filter(Boolean)
    .join(` `)

  const payload: SidebarRowInfoPayload = {
    entity,
    title,
    sessionId,
    childCount,
  }

  const splat = entity.url.replace(/^\//, ``)

  return (
    <HoverCard.Trigger
      handle={hoverHandle}
      payload={payload}
      render={
        <Link
          to="/entity/$"
          params={{ _splat: splat }}
          className={className}
          style={{ paddingLeft: BASE_PADDING_LEFT + depth * INDENT_PX }}
          title={title}
          preload="intent"
        >
          <span className={styles.iconSlot}>
            <span className={styles.statusDot}>
              <StatusDot status={entity.status} />
            </span>
            {onTogglePin && (
              <button
                type="button"
                className={styles.pinBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin()
                }}
                aria-label={pinned ? `Unpin session` : `Pin session`}
                aria-pressed={pinned}
              >
                <Pin
                  size={12}
                  fill={pinned ? `currentColor` : `none`}
                  style={{
                    transform: pinned ? `rotate(45deg)` : undefined,
                  }}
                />
              </button>
            )}
          </span>

          <span className={styles.title}>{title}</span>

          <span
            className={[
              styles.type,
              hasChildren && !expanded ? styles.typeWithCount : null,
            ]
              .filter(Boolean)
              .join(` `)}
          >
            {entity.type}
            {hasChildren && !expanded ? ` +${childCount}` : ``}
          </span>

          {hasChildren && onToggleExpand ? (
            expanded ? (
              <button
                type="button"
                className={styles.expandBtnVisible}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand()
                }}
                aria-label="Collapse subtree"
                aria-expanded
              >
                <ChevronDown size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.expandOverlay}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand()
                }}
                aria-label={`Expand subtree (${childCount} subagent${childCount === 1 ? `` : `s`})`}
                aria-expanded={false}
              >
                <ChevronRight size={14} />
              </button>
            )
          ) : null}
        </Link>
      }
    />
  )
})

/**
 * Body of the shared sidebar info popout. Rendered once by
 * `<Sidebar>` inside the shared `<HoverCard.Root>`, with its props
 * coming from whichever row currently owns the hover state.
 */
export function SidebarRowInfo({
  entity,
  title,
  sessionId,
  childCount,
}: SidebarRowInfoPayload): React.ReactElement {
  // Both stamps come straight off the entity. Absolute spawn time
  // gives the user an at-a-glance sense of when the session started;
  // the relative "last active" line is what they typically scan for
  // when triaging recent work. Re-evaluated on every popout open
  // because the body re-renders whenever the active trigger changes.
  const spawnedAbs = formatAbsoluteDateTime(entity.created_at)
  const lastActiveRel = formatRelativeTime(entity.updated_at)
  const lastActiveAbs = formatAbsoluteDateTime(entity.updated_at)

  return (
    <div className={styles.info}>
      <Text size={2} className={styles.infoTitle}>
        {title}
      </Text>
      <div className={styles.infoMeta}>
        <Text size={1} family="mono" tone="muted">
          {sessionId}
        </Text>
        <Text size={1} tone="muted">
          {entity.type} · {entity.status}
          {childCount > 0
            ? ` · ${childCount} subagent${childCount === 1 ? `` : `s`}`
            : ``}
        </Text>
      </div>
      <div className={styles.infoTimes}>
        <InfoTimeRow label="Spawned" value={spawnedAbs} />
        <InfoTimeRow
          label="Last active"
          value={lastActiveRel}
          title={lastActiveAbs}
        />
      </div>
    </div>
  )
}

function InfoTimeRow({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}): React.ReactElement {
  return (
    <div className={styles.infoTimeRow} title={title}>
      <Text size={1} tone="muted">
        {label}
      </Text>
      <Text size={1}>{value}</Text>
    </div>
  )
}
