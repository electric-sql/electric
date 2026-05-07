const pendingSelections = new Map<string, string>()

export const STATE_EXPLORER_SOURCE_REQUEST_EVENT = `electric-agents-ui:state-explorer-source-request`

export type StateExplorerSourceRequest = {
  entityUrl: string
  sourceId: string
}

export function requestStateExplorerSource(
  entityUrl: string,
  sourceId: string
): void {
  pendingSelections.set(entityUrl, sourceId)
  window.dispatchEvent(
    new CustomEvent<StateExplorerSourceRequest>(
      STATE_EXPLORER_SOURCE_REQUEST_EVENT,
      { detail: { entityUrl, sourceId } }
    )
  )
}

export function consumeStateExplorerSourceRequest(
  entityUrl: string
): string | null {
  const sourceId = pendingSelections.get(entityUrl) ?? null
  if (sourceId) pendingSelections.delete(entityUrl)
  return sourceId
}
