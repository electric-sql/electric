export function withoutLeadingSlash(path: string): string {
  return path.replace(/^\/+/, ``)
}

export function withLeadingSlash(path: string): string {
  return path.startsWith(`/`) ? path : `/${path}`
}

export function prefixTenantStreamPath(path: string, tenantId: string): string {
  const normalized = withoutLeadingSlash(path)
  if (!normalized || normalized === tenantId) return tenantId
  if (normalized.startsWith(`${tenantId}/`)) return normalized
  return `${tenantId}/${normalized}`
}

export function stripTenantStreamPrefix(
  path: string,
  tenantId: string
): string {
  const normalized = withoutLeadingSlash(path)
  if (normalized === tenantId) return ``
  if (normalized.startsWith(`${tenantId}/`)) {
    return normalized.slice(tenantId.length + 1)
  }
  return normalized
}
