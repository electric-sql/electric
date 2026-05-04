import { SidebarRow } from './SidebarRow'
import type { SidebarRowInfoPayload } from './SidebarRow'
import type { HoverCard } from '../ui'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'
import sidebarRowStyles from './SidebarRow.module.css'

type SidebarTreeProps = {
  entity: ElectricEntity
  childrenByParent: Map<string, Array<ElectricEntity>>
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  isExpanded: (url: string) => boolean
  toggleExpanded: (url: string) => void
  pinnedUrls: ReadonlyArray<string>
  onTogglePin: (url: string) => void
  depth?: number
  hoverHandle: ReturnType<typeof HoverCard.useHandle<SidebarRowInfoPayload>>
}

// Geometry constants — must mirror `SidebarRow.tsx` exactly. The
// trunk x-position for a subtree of children-at-depth-N is the
// horizontal centre of their *parent's* icon column, computed in the
// row's own coordinate space:
//
//   parent padding-left  = BASE_PADDING_LEFT + parentDepth * INDENT_PX
//   parent icon-slot/2   = ICON_SLOT / 2
//
// so trunk_x = (3 + parentDepth * 12) + 11 = 14 + parentDepth * 12.
//
// Replicating the constants here keeps the visual tree-line in sync
// with row indentation — bumping `INDENT_PX` in SidebarRow only
// requires bumping `INDENT_PX` here.
const BASE_PADDING_LEFT = 3
const INDENT_PX = 12
const ICON_SLOT_HALF = 11

/**
 * Recursive subtree renderer.
 *
 * Layout pieces:
 *   - Each tree node (row + optional subtree of children) is wrapped
 *     in a `.treeNode` so `:last-child` selectors in CSS can find
 *     the bottom-most sibling for the curved connector.
 *   - Children, when expanded, sit inside a `.subtree` wrapper that
 *     carries an inline `--tree-trunk-x` CSS variable pointing at the
 *     centre of the parent's icon column. CSS in `SidebarRow.module.css`
 *     reads that variable to draw a continuous tree line down through
 *     the children with a curved corner on the last one.
 *
 * Pinning policy:
 *   - Only depth-0 nodes (roots / parent agents) get an `onTogglePin`
 *     handler — children of an expanded subtree don't show the pin
 *     affordance, since pinning a child wouldn't make sense in the
 *     "Pinned" section above (we want the whole subtree, not a leaf).
 */
export function SidebarTree({
  entity,
  childrenByParent,
  selectedEntityUrl,
  onSelectEntity,
  isExpanded,
  toggleExpanded,
  pinnedUrls,
  onTogglePin,
  depth = 0,
  hoverHandle,
}: SidebarTreeProps): React.ReactElement {
  // Pinned children are never expected (pinning is gated to roots
  // below) but the filter is kept defensively in case a stale pinned
  // url survives in localStorage from before this gating landed.
  const allChildren = childrenByParent.get(entity.url) ?? []
  const children = allChildren.filter((c) => !pinnedUrls.includes(c.url))
  const expanded = isExpanded(entity.url)
  const isRoot = depth === 0

  // CSS custom property is forwarded into the subtree so the connector
  // pseudo-elements on each child row know where to draw the trunk.
  const subtreeStyle = {
    [`--tree-trunk-x`]: `${BASE_PADDING_LEFT + depth * INDENT_PX + ICON_SLOT_HALF}px`,
  } as React.CSSProperties

  return (
    <div className={sidebarRowStyles.treeNode}>
      <SidebarRow
        entity={entity}
        selected={entity.url === selectedEntityUrl}
        onSelect={() => onSelectEntity(entity.url)}
        depth={depth}
        childCount={children.length}
        expanded={expanded}
        onToggleExpand={() => toggleExpanded(entity.url)}
        pinned={pinnedUrls.includes(entity.url)}
        onTogglePin={isRoot ? () => onTogglePin(entity.url) : undefined}
        hoverHandle={hoverHandle}
      />
      {expanded && children.length > 0 && (
        <div className={sidebarRowStyles.subtree} style={subtreeStyle}>
          {children.map((child) => (
            <SidebarTree
              key={child.url}
              entity={child}
              childrenByParent={childrenByParent}
              selectedEntityUrl={selectedEntityUrl}
              onSelectEntity={onSelectEntity}
              isExpanded={isExpanded}
              toggleExpanded={toggleExpanded}
              pinnedUrls={pinnedUrls}
              onTogglePin={onTogglePin}
              depth={depth + 1}
              hoverHandle={hoverHandle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
