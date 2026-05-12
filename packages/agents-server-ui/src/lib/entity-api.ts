function trimTrailingSlash(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, ``)
}

function withLeadingSlash(path: string): string {
  return path.startsWith(`/`) ? path : `/${path}`
}

export function entityApiUrl(
  baseUrl: string,
  entityUrl: string,
  suffix = ``
): string {
  return `${trimTrailingSlash(baseUrl)}/_electric/entities${withLeadingSlash(entityUrl)}${suffix}`
}

export function entitySpawnApiUrl(
  baseUrl: string,
  type: string,
  name: string
): string {
  return `${trimTrailingSlash(baseUrl)}/_electric/entities/${encodeURIComponent(type)}/${encodeURIComponent(name)}`
}
