import { SidebarRow } from './SidebarRow'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

type SidebarTreeProps = {
  entity: ElectricEntity
  childrenByParent: Map<string, Array<ElectricEntity>>
  selectedEntityUrl: string | null
  onSelectEntity: (url: string) => void
  isExpanded: (url: string) => boolean
  toggleExpanded: (url: string) => void
  depth?: number
}

/**
 * Recursive subtree renderer. Children are hidden until the user clicks
 * the caret on a row; expansion state lives in `useExpandedTreeNodes`
 * so it persists across reloads.
 */
export function SidebarTree({
  entity,
  childrenByParent,
  selectedEntityUrl,
  onSelectEntity,
  isExpanded,
  toggleExpanded,
  depth = 0,
}: SidebarTreeProps): React.ReactElement {
  const children = childrenByParent.get(entity.url) ?? []
  const hasChildren = children.length > 0
  const expanded = isExpanded(entity.url)

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
            depth={depth + 1}
          />
        ))}
    </>
  )
}
