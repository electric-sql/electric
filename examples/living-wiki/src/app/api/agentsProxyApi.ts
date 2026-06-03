import type {
  AgentsEntityTargetInput,
  AgentsObserveTargetInput,
} from '../../shared/agents-proxy'

export function getEntityStreamUrl(input: AgentsEntityTargetInput): string {
  const wikiSpaceId = encodeURIComponent(input.wikiSpaceId)
  const entityKind = encodeURIComponent(input.entityKind)
  const entityId = encodeURIComponent(input.entityId)

  return `/api/agents/entities/${wikiSpaceId}/${entityKind}/${entityId}/stream`
}

export function getObserveUrl(
  input: AgentsObserveTargetInput,
  protocolParams?: Record<string, string> | URLSearchParams
): string {
  const wikiSpaceId = encodeURIComponent(input.wikiSpaceId)
  const observeKind = encodeURIComponent(input.observeKind)

  const basePath = `/api/observe/${wikiSpaceId}/${observeKind}`

  if (!protocolParams) {
    return basePath
  }

  const searchParams =
    protocolParams instanceof URLSearchParams
      ? protocolParams
      : new URLSearchParams(protocolParams)

  const qs = searchParams.toString()

  return qs.length > 0 ? `${basePath}?${qs}` : basePath
}
