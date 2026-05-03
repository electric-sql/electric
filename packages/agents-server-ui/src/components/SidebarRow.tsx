import { ChevronDown, ChevronRight } from 'lucide-react'
import { StatusDot } from './StatusDot'
import { getEntityDisplayTitle } from '../lib/entityDisplay'
import styles from './SidebarRow.module.css'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

const INDENT_PX = 12
const BASE_PADDING_LEFT = 8

type SidebarRowProps = {
  entity: ElectricEntity
  selected: boolean
  onSelect: () => void
  depth?: number
  hasChildren?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
}

/**
 * One row in the sidebar tree.
 *
 * Single line, fixed `--ds-row-height-md` tall:
 *   [caret? ▸/▾]  [● status]  [title (truncated)]  [type pill]
 *
 * The caret is rendered only when `hasChildren`. For depth > 0 the row
 * is indented to communicate hierarchy without explicit tree-guide
 * lines (Cursor-style — relies on the indent + caret alone).
 */
export function SidebarRow({
  entity,
  selected,
  onSelect,
  depth = 0,
  hasChildren = false,
  expanded = false,
  onToggleExpand,
}: SidebarRowProps): React.ReactElement {
  const { title } = getEntityDisplayTitle(entity)
  const isStopped = entity.status === `stopped`
  const className = [
    styles.row,
    selected ? styles.selected : null,
    isStopped ? styles.stopped : null,
  ]
    .filter(Boolean)
    .join(` `)
  return (
    <div
      role="button"
      tabIndex={0}
      className={className}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === `Enter` || e.key === ` `) {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{ paddingLeft: BASE_PADDING_LEFT + depth * INDENT_PX }}
      title={title}
    >
      {hasChildren && onToggleExpand ? (
        <button
          type="button"
          className={styles.caret}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand()
          }}
          aria-label={expanded ? `Collapse subtree` : `Expand subtree`}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className={styles.caretSpacer} />
      )}
      <StatusDot status={entity.status} />
      <span className={styles.title}>{title}</span>
      <span className={styles.typePill}>{entity.type}</span>
    </div>
  )
}
