import { useEffect } from 'react'
import { SidebarRow } from './SidebarRow'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

type SidebarTreeProps = {
  entity: ElectricEntity
  childrenByParent: Map<string, Array<ElectricEntity>>
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  isExpanded: (url: string) => boolean
  toggleExpanded: (url: string) => void
  expandNode: (url: string) => void
  /** When set, only render entities present in this set; auto-expands
   *  ancestors so matches stay visible. Used by the filter input. */
  visibleUrls?: Set<string> | null
  depth?: number
}

/**
 * Recursive subtree renderer. Children are hidden until the user clicks
 * the caret on a row. When a `visibleUrls` filter is active, ancestors
 * of any match are force-expanded so matches stay reachable without
 * requiring the user to drill in manually.
 */
export function SidebarTree({
  entity,
  childrenByParent,
  selectedEntityUrl,
  onSelectEntity,
  isExpanded,
  toggleExpanded,
  expandNode,
  visibleUrls = null,
  depth = 0,
}: SidebarTreeProps): React.ReactElement | null {
  const children = childrenByParent.get(entity.url) ?? []
  const hasChildren = children.length > 0
  const filtering = visibleUrls !== null
  const matchesFilter = !filtering || visibleUrls!.has(entity.url)
  const expanded = filtering ? hasChildren : isExpanded(entity.url)

  useEffect(() => {
    if (filtering && hasChildren && !isExpanded(entity.url)) {
      expandNode(entity.url)
    }
  }, [filtering, hasChildren, entity.url, expandNode, isExpanded])

  if (!matchesFilter) return null

  return (
    <>
      <SidebarRow
        entity={entity}
        selected={entity.url === selectedEntityUrl}
        onSelect={() => onSelectEntity(entity.url)}
        depth={depth}
        hasChildren={hasChildren}
        expanded={expanded}
        onToggleExpand={() => toggleExpanded(entity.url)}
      />
      {expanded &&
        children.map((child) => (
          <SidebarTree
            key={child.url}
            entity={child}
            childrenByParent={childrenByParent}
            selectedEntityUrl={selectedEntityUrl}
            onSelectEntity={onSelectEntity}
            isExpanded={isExpanded}
            toggleExpanded={toggleExpanded}
            expandNode={expandNode}
            visibleUrls={visibleUrls}
            depth={depth + 1}
          />
        ))}
    </>
  )
}
