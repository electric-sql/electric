export const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`

export function mergeElectricPrincipalHeader(
  headers: HeadersInit | undefined,
  principal: string | undefined
): Record<string, string> | undefined {
  const merged = new Headers(headers)
  const trimmedPrincipal = principal?.trim()
  if (trimmedPrincipal !== undefined && trimmedPrincipal.length > 0) {
    merged.set(ELECTRIC_PRINCIPAL_HEADER, trimmedPrincipal)
  }
  const normalized = Object.fromEntries(merged.entries())
  return Object.keys(normalized).length > 0 ? normalized : undefined
}
