import { memo } from 'react'
import { View } from 'react-native'
import {
  BASE_PADDING_LEFT,
  ICON_SLOT_HALF,
  INDENT_PX,
  SessionRow,
} from './SessionRow'
import { toggleExpanded, useIsExpanded } from '../lib/expandedTree'
import type { ElectricEntity } from '../lib/agentsClient'

/**
 * Recursive subtree renderer. Mobile mirror of
 * `agents-server-ui/src/components/SidebarTree.tsx`.
 *
 * Memoised on its props so a sibling subtree expanding/collapsing
 * doesn't cascade-rerender every tree in the list. Expansion state
 * itself is read via `useIsExpanded` from the external store in
 * `expandedTree.ts`, so toggling row A's caret only re-renders A —
 * not its siblings, parent, or ancestors.
 *
 * The trunk x-position for a subtree of children-at-depth-N is the
 * horizontal centre of their *parent's* icon column, in the row's
 * own coordinate space:
 *
 *   parent padding-left  = BASE_PADDING_LEFT + parentDepth * INDENT_PX
 *   parent icon-slot/2   = ICON_SLOT_HALF
 *
 * → trunk_x = BASE_PADDING_LEFT + parentDepth * INDENT_PX + ICON_SLOT_HALF
 */
export const SessionTree = memo(function SessionTree({
  entity,
  childrenByParent,
  depth = 0,
  isLastSibling = true,
  parentTrunkX,
  onSelectEntity,
  currentPrincipalUrl = null,
}: {
  entity: ElectricEntity
  childrenByParent: Map<string, Array<ElectricEntity>>
  depth?: number
  isLastSibling?: boolean
  /**
   * Pre-computed trunk x for *this* row's connector — supplied by
   * the parent `<SessionTree>`. Roots (depth 0) pass `undefined` so
   * no connector is drawn.
   */
  parentTrunkX?: number
  onSelectEntity: (url: string) => void
  currentPrincipalUrl?: string | null
}): React.ReactElement {
  const expanded = useIsExpanded(entity.url)
  const children = childrenByParent.get(entity.url) ?? []
  const hasChildren = children.length > 0

  // Trunk x for *this* row's children, computed once per render.
  const myTrunkX = BASE_PADDING_LEFT + depth * INDENT_PX + ICON_SLOT_HALF

  return (
    <View>
      <SessionRow
        entity={entity}
        depth={depth}
        childCount={children.length}
        expanded={expanded}
        onToggleExpand={
          hasChildren ? () => toggleExpanded(entity.url) : undefined
        }
        onPress={() => onSelectEntity(entity.url)}
        currentPrincipalUrl={currentPrincipalUrl}
        connector={
          parentTrunkX !== undefined
            ? { trunkX: parentTrunkX, isLastSibling }
            : null
        }
      />
      {expanded && hasChildren ? (
        <View>
          {children.map((child, idx) => (
            <SessionTree
              key={child.url}
              entity={child}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              isLastSibling={idx === children.length - 1}
              parentTrunkX={myTrunkX}
              onSelectEntity={onSelectEntity}
              currentPrincipalUrl={currentPrincipalUrl}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
})

/**
 * Bucket entities by parent URL and identify the roots (entities
 * whose parent isn't visible in the same set). Mirrors
 * `buildEntityTree` from `Sidebar.tsx`.
 */
export function buildEntityTree(entities: ReadonlyArray<ElectricEntity>): {
  roots: Array<ElectricEntity>
  childrenByParent: Map<string, Array<ElectricEntity>>
} {
  const urlSet = new Set(entities.map((e) => e.url))
  const childrenByParent = new Map<string, Array<ElectricEntity>>()
  const roots: Array<ElectricEntity> = []
  for (const entity of entities) {
    const parent = entity.parent
    if (parent && urlSet.has(parent)) {
      const list = childrenByParent.get(parent) ?? []
      list.push(entity)
      childrenByParent.set(parent, list)
    } else {
      roots.push(entity)
    }
  }
  return { roots, childrenByParent }
}
