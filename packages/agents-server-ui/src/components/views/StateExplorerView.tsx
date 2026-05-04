import { StateExplorerPanel } from '../stateExplorer/StateExplorerPanel'
import type { ViewProps } from '../../lib/workspace/viewRegistry'

/**
 * Thin `ViewProps` adapter around `<StateExplorerPanel>` so it can be
 * registered in the view registry without leaking the registry's prop
 * shape into the panel itself.
 */
export function StateExplorerView({
  baseUrl,
  entityUrl,
}: ViewProps): React.ReactElement {
  return <StateExplorerPanel baseUrl={baseUrl} entityUrl={entityUrl} />
}
