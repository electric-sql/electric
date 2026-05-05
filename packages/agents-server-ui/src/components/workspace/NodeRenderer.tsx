import { SplitContainer } from './SplitContainer'
import { TileContainer } from './TileContainer'
import type { WorkspaceNode } from '../../lib/workspace/types'

/**
 * Pure dispatch from a node in the workspace tree to the right
 * container component. Recurses naturally (`SplitContainer` calls back
 * into `NodeRenderer` for each of its children).
 */
export function NodeRenderer({
  node,
}: {
  node: WorkspaceNode
}): React.ReactElement {
  return node.kind === `split` ? (
    <SplitContainer split={node} />
  ) : (
    <TileContainer tile={node} />
  )
}
