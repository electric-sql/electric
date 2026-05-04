import { SidebarRow } from './SidebarRow'
import type { SidebarRowInfoPayload } from './SidebarRow'
import type { HoverCard } from '../ui'
import type { ElectricEntity } from '../lib/ElectricAgentsProvider'

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

/**
 * Recursive subtree renderer. Children are hidden until the user
 * clicks the expand affordance on the parent row; expansion state
 * lives in `useExpandedTreeNodes` so it persists across reloads.
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
  // Pinned children are surfaced in the Pinned section at the top of
  // the sidebar — drop them from the parent's expanded subtree so a
  // pinned entity is only ever listed in one place.
  const allChildren = childrenByParent.get(entity.url) ?? []
  const children = allChildren.filter((c) => !pinnedUrls.includes(c.url))
  const expanded = isExpanded(entity.url)

  return (
    <>
      <SidebarRow
        entity={entity}
        selected={entity.url === selectedEntityUrl}
        onSelect={() => onSelectEntity(entity.url)}
        depth={depth}
        childCount={children.length}
        expanded={expanded}
        onToggleExpand={() => toggleExpanded(entity.url)}
        pinned={pinnedUrls.includes(entity.url)}
        onTogglePin={() => onTogglePin(entity.url)}
        hoverHandle={hoverHandle}
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
            pinnedUrls={pinnedUrls}
            onTogglePin={onTogglePin}
            depth={depth + 1}
            hoverHandle={hoverHandle}
          />
        ))}
    </>
  )
}
