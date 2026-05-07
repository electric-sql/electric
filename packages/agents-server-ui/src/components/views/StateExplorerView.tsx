import { StateExplorerPanel } from '../stateExplorer/StateExplorerPanel'
import { useWorkspace } from '../../hooks/useWorkspace'
import type { ViewProps } from '../../lib/workspace/viewRegistry'

/**
 * Thin `ViewProps` adapter around `<StateExplorerPanel>` so it can be
 * registered in the view registry without leaking the registry's prop
 * shape into the panel itself.
 */
export function StateExplorerView({
  baseUrl,
  entityUrl,
  tileId,
  viewParams,
}: ViewProps): React.ReactElement {
  const { helpers } = useWorkspace()
  const selectedSourceId = viewParams?.source

  return (
    <StateExplorerPanel
      baseUrl={baseUrl}
      entityUrl={entityUrl}
      selectedSourceId={selectedSourceId}
      onSelectedSourceIdChange={(sourceId) => {
        helpers.setTileView(tileId, `state-explorer`, {
          viewParams: sourceId ? { source: sourceId } : undefined,
        })
      }}
    />
  )
}
