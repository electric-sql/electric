function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, ``)
}

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
  return `${trimTrailingSlash(baseUrl)}${entityApiPath(entityUrl, suffix)}`
}

export function assertedIdentityHeaders(
  identity: string | undefined
): Record<string, string> {
  const trimmed = identity?.trim()
  return trimmed ? { 'x-electric-asserted-email': trimmed } : {}
}
