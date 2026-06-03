import type {
  AgentsEntityTargetInput,
  AgentsObserveTargetInput,
} from '../../shared/agents-proxy'

export function getEntityStreamUrl(
  input: AgentsEntityTargetInput,
  protocolParams?: Record<string, string> | URLSearchParams
): string {
  const wikiSpaceId = encodeURIComponent(input.wikiSpaceId)
  const entityKind = encodeURIComponent(input.entityKind)
  const entityId = encodeURIComponent(input.entityId)

  return withSearchParams(
    `/api/agents/entities/${wikiSpaceId}/${entityKind}/${entityId}/stream`,
    protocolParams
  )
}

export function getObserveUrl(
  input: AgentsObserveTargetInput,
  protocolParams?: Record<string, string> | URLSearchParams
): string {
  const wikiSpaceId = encodeURIComponent(input.wikiSpaceId)
  const observeKind = encodeURIComponent(input.observeKind)

  return withSearchParams(
    `/api/observe/${wikiSpaceId}/${observeKind}`,
    protocolParams
  )
}

function withSearchParams(
  basePath: string,
  protocolParams?: Record<string, string> | URLSearchParams
): string {
  if (!protocolParams) return basePath

  const searchParams =
    protocolParams instanceof URLSearchParams
      ? protocolParams
      : new URLSearchParams(protocolParams)

  const qs = searchParams.toString()

  return qs.length > 0 ? `${basePath}?${qs}` : basePath
}
