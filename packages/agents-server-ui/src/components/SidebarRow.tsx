import { memo, useMemo } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { ChevronDown, ChevronRight, Pin, Users } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { HoverCard, Icon, Text } from '../ui'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import { useEntityRuntimeInfo } from './EntityRuntimeBadges'
import { runnerDisplayLabel } from '../lib/entityRuntime'
import { formatAbsoluteDateTime, formatRelativeTime } from '../lib/formatTime'
import { setWorkspaceDrag } from '../lib/workspace/dragPayload'
import { useCurrentPrincipal } from '../hooks/useCurrentPrincipal'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import {
  normalizePrincipalUrl,
  principalKeyFromInput,
  userIdFromPrincipal,
} from '../lib/principals'
import styles from './SidebarRow.module.css'
import type {
  ElectricEntity,
  ElectricUser,
} from '../lib/ElectricAgentsProvider'

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
  /**
   * Triggered for plain clicks. The row dispatches a different action
   * for modifier-clicks (e.g. ⌘-click → open in new split); those go
   * through `onOpenInSplit` instead so the sidebar can decide on a
   * per-app basis what those modifiers mean.
   */
  onSelect: () => void
  /**
   * Optional: triggered when the user ⌘/Ctrl-clicks the row (or
   * middle-clicks). Used to open the entity in a new split rather
   * than replacing the active tile. The sidebar wires this to
   * `helpers.openEntity(url, { target: { groupId, position: 'split-right' }})`.
   */
  onOpenInSplit?: () => void
  depth?: number
  /** Number of immediate children. 0 means no expand affordance. */
  childCount?: number
  expanded?: boolean
  onToggleExpand?: () => void
  pinned?: boolean
  onTogglePin?: () => void
  currentPrincipalUrl: string | null
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
  onSelect,
  onOpenInSplit,
  depth = 0,
  childCount = 0,
  expanded = false,
  onToggleExpand,
  pinned = false,
  onTogglePin,
  currentPrincipalUrl,
  hoverHandle,
}: SidebarRowProps): React.ReactElement {
  const { title } = getEntityDisplayTitle(entity)
  const isStopped = entity.status === `stopped` || entity.status === `killed`
  const hasChildren = childCount > 0
  const createdByUrl = normalizePrincipalUrl(entity.created_by)
  const shared =
    createdByUrl !== null &&
    currentPrincipalUrl !== null &&
    createdByUrl !== currentPrincipalUrl
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

  return (
    <HoverCard.Trigger
      handle={hoverHandle}
      payload={payload}
      render={
        <div
          role="button"
          tabIndex={0}
          className={className}
          draggable
          onDragStart={(e) => {
            setWorkspaceDrag(
              e,
              {
                kind: `sidebar-entity`,
                entityUrl: entity.url,
              },
              { dragImage: `sidebar-row` }
            )
          }}
          onClick={(e) => {
            // ⌘/Ctrl-click or middle-click → open in new split (when
            // the sidebar wired up an `onOpenInSplit` handler);
            // otherwise plain selection. Matches VS Code's
            // ⌘-click-on-file-tree → open to side.
            if (onOpenInSplit && (e.metaKey || e.ctrlKey || e.button === 1)) {
              e.preventDefault()
              onOpenInSplit()
              return
            }
            onSelect()
          }}
          onAuxClick={(e) => {
            // Middle-click also opens in split (button 1 doesn't always
            // fire onClick on every browser; onAuxClick is the
            // canonical handler).
            if (onOpenInSplit && e.button === 1) {
              e.preventDefault()
              onOpenInSplit()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === `Enter` || e.key === ` `) {
              e.preventDefault()
              onSelect()
            }
          }}
          style={{ paddingLeft: BASE_PADDING_LEFT + depth * INDENT_PX }}
          title={title}
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
                <Icon
                  icon={Pin}
                  size={1}
                  fill={pinned ? `currentColor` : `none`}
                  style={{
                    transform: pinned ? `rotate(45deg)` : undefined,
                  }}
                />
              </button>
            )}
          </span>

          <span className={styles.title}>{title}</span>

          {shared && (
            <span className={styles.sharedIcon} title="Shared with you">
              <Icon icon={Users} size={1} />
            </span>
          )}

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
                <Icon icon={ChevronDown} size={2} />
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
                <Icon icon={ChevronRight} size={2} />
              </button>
            )
          ) : null}
        </div>
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

  // Runner + sandbox the session is associated with — resolved from the
  // (shared) runners collection so we can show labels rather than raw ids.
  const runtime = useEntityRuntimeInfo(entity)
  const runnerLabel = runtime.runnerId
    ? runnerDisplayLabel(runtime.runner, runtime.runnerId)
    : null
  const sandboxLabel = runtime.sandbox.label
  const { label: createdByLabel, title: createdByTitle } = usePrincipalDisplay(
    entity.created_by
  )

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
        {runnerLabel && <InfoTimeRow label="Runner" value={runnerLabel} />}
        {sandboxLabel && <InfoTimeRow label="Sandbox" value={sandboxLabel} />}
        {createdByLabel && (
          <InfoTimeRow
            label="Created by"
            value={createdByLabel}
            title={createdByTitle}
          />
        )}
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

function usePrincipalDisplay(value: string | null | undefined): {
  label: string | null
  title?: string
} {
  const { usersCollection } = useElectricAgents()
  const { principal: currentPrincipal } = useCurrentPrincipal()
  const key = principalKeyFromInput(value)
  const currentKey = principalKeyFromInput(currentPrincipal)
  const userId = userIdFromPrincipal(value)

  const { data: users = [] } = useLiveQuery(
    (q) => {
      if (!usersCollection) return undefined
      return q.from({ user: usersCollection })
    },
    [usersCollection]
  )

  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users]
  )

  if (!key) return { label: null }
  if (key === currentKey) return { label: `Me`, title: key }
  if (userId) {
    const user = usersById.get(userId)
    return {
      label: userDisplayName(user) ?? formatPrincipalKey(key),
      title: key,
    }
  }
  return { label: formatPrincipalKey(key), title: key }
}

function userDisplayName(user: ElectricUser | undefined): string | null {
  if (!user) return null
  return user.display_name || user.email || null
}

function formatPrincipalKey(key: string): string {
  const colon = key.indexOf(`:`)
  if (colon <= 0) return shortenPrincipalId(key)
  const kind = key.slice(0, colon)
  const id = key.slice(colon + 1)
  return `${kind}:${shortenPrincipalId(id)}`
}

function shortenPrincipalId(id: string): string {
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
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
