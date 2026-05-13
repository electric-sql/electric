import { appendPathToUrl } from '@electric-ax/agents-runtime'

function withLeadingSlash(path: string): string {
  return path.startsWith(`/`) ? path : `/${path}`
}

export function entityApiPath(entityUrl: string, suffix = ``): string {
  return `/_electric/entities${withLeadingSlash(entityUrl)}${suffix}`
}

export function entityApiUrl(
  baseUrl: string,
  entityUrl: string,
  suffix = ``
): string {
  return appendPathToUrl(baseUrl, entityApiPath(entityUrl, suffix))
}
