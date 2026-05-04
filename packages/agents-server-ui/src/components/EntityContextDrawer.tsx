import { useState } from 'react'
import { ChevronDown, ChevronRight, CornerUpLeft } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { Text } from '../ui'
import { StatusDot } from './StatusDot'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import styles from './EntityContextDrawer.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

/**
 * Drawer that docks ABOVE the chat composer at the bottom of an entity
 * session, surfacing context about related entities (and, in time,
 * pending messages, tool-call alerts, etc.).
 *
 * The composer in `<MessageInput>` is z-indexed over the drawer so the
 * drawer's bottom edge tucks behind it — visually the composer reads
 * as a tray pulled forward over the drawer card. The drawer's
 * `padding-bottom` reserves the overlap area so its content never
 * disappears under the composer. Horizontal `margin-inline` insets
 * the drawer inside the composer's border radius so it visually reads
 * as nested *inside* the composer.
 *
 * Sections are independent and self-determine whether to render. The
 * drawer returns `null` when no section has anything to say so the
 * composer's existing -20px lift into the timeline above it is
 * preserved unchanged for sessions without related entities.
 */
export function EntityContextDrawer({
  entity,
}: {
  entity: ElectricEntity
}): React.ReactElement | null {
  const { entitiesCollection } = useElectricAgents()
  const navigate = useNavigate()

  const entityUrl = entity.url
  const parentUrl = entity.parent

  // Sub-agents: any entity whose `parent` points back at us. Sorted by
  // creation time so the order matches the sidebar tree.
  const { data: subAgents = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.parent, entityUrl))
        .orderBy(({ e }) => e.created_at, `asc`)
    },
    [entitiesCollection, entityUrl]
  )

  // Parent: at most one row. We still go through the live collection so
  // status changes upstream reflect here without a refetch.
  const { data: parentMatches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !parentUrl) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, parentUrl))
    },
    [entitiesCollection, parentUrl]
  )
  const parent = parentMatches.at(0) ?? null

  if (!parent && subAgents.length === 0) return null

  const goTo = (url: string): void => {
    navigate({
      to: `/entity/$`,
      params: { _splat: url.replace(/^\//, ``) },
    })
  }

  return (
    <div className={styles.drawer}>
      {parent && <ParentRow parent={parent} onSelect={goTo} />}
      {subAgents.length > 0 && (
        <SubAgentsSection agents={subAgents} onSelect={goTo} />
      )}
    </div>
  )
}

/**
 * Non-expandable parent row. The whole row is the link — clicking
 * navigates to the parent. The leading `CornerUpLeft` icon visually
 * marks "go up to the parent"; the rest of the row matches the
 * sub-agent rows (status dot + title + type/id meta) so the parent
 * reads as the same kind of thing as a child, just from a different
 * direction.
 */
function ParentRow({
  parent,
  onSelect,
}: {
  parent: ElectricEntity
  onSelect: (url: string) => void
}): React.ReactElement {
  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => onSelect(parent.url)}
      title={`Open parent: ${parent.url}`}
    >
      <span className={styles.iconSlot}>
        <CornerUpLeft size={14} className={styles.parentIcon} />
      </span>
      <EntityRowBody entity={parent} />
    </button>
  )
}

/**
 * Expandable sub-agents section. Collapsed shows a count; expanded
 * lists each child as a full-width clickable row. Local state — not
 * persisted across navigations because the drawer's purpose is
 * "context for THIS session" and the right default for a new session
 * is collapsed.
 */
function SubAgentsSection({
  agents,
  onSelect,
}: {
  agents: ReadonlyArray<ElectricEntity>
  onSelect: (url: string) => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const label = agents.length === 1 ? `Sub Agent` : `Sub Agents`

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.row}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className={styles.iconSlot}>
          <Chevron size={14} className={styles.chevron} />
        </span>
        <Text size={2} className={styles.headerLabel}>
          {agents.length} {label}
        </Text>
      </button>
      {expanded &&
        agents.map((agent) => (
          <button
            key={agent.url}
            type="button"
            className={styles.row}
            onClick={() => onSelect(agent.url)}
            title={agent.url}
          >
            <span className={styles.iconSlot}>
              <StatusDot status={agent.status} size={7} />
            </span>
            <EntityRowBody entity={agent} />
          </button>
        ))}
    </div>
  )
}

/**
 * Shared body layout for every entity-bearing row in the drawer
 * (parent + sub-agents). Title on the left (truncated), meta on the
 * right (`type` plus the URL slug when the title doesn't already come
 * from the slug — avoids "agent · agent" duplicates). The leading
 * icon slot is owned by the parent component since it varies per row
 * type (CornerUpLeft / chevron / status dot).
 */
function EntityRowBody({
  entity,
}: {
  entity: ElectricEntity
}): React.ReactElement {
  const { title, isFromSlug } = getEntityDisplayTitle(entity)
  const id = entity.url.split(`/`).pop() ?? entity.url
  const meta = isFromSlug ? entity.type : `${entity.type} · ${id}`
  return (
    <span className={styles.rowMain}>
      <Text size={2} className={styles.rowTitle}>
        {title}
      </Text>
      <Text size={1} tone="muted" className={styles.rowMeta}>
        {meta}
      </Text>
    </span>
  )
}
