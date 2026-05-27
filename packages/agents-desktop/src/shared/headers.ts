import { LOCALHOST_HOST, LOOPBACK_IPV4_HOST } from './constants'
import type { ServerConfig } from './types'

export const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`

const PRINCIPAL_KEY_PREFIXES = new Set([`user`, `agent`, `service`, `system`])

export function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const headers = new Headers()
  for (const source of sources) {
    if (!source) continue
    new Headers(source).forEach((value, key) => headers.set(key, value))
  }
  const merged = headersToRecord(headers)
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function hasHeader(
  headers: Record<string, string> | undefined,
  name: string
): boolean {
  return headers ? new Headers(headers).has(name) : false
}

export function runnerOwnerPrincipalFromHeaders(
  headers: Record<string, string> | undefined,
  fallbackPrincipal: string | undefined
): string | undefined {
  const normalized = new Headers(headers)
  const principalKey = normalized.get(ELECTRIC_PRINCIPAL_HEADER)?.trim()
  if (principalKey) {
    return principalKey.startsWith(`/principal/`)
      ? principalKey
      : `/principal/${encodeURIComponent(principalKey)}`
  }
  if (normalized.has(`authorization`)) return undefined
  return fallbackPrincipal
}

export function runnerOwnerPrincipalFromUserId(
  userId: string | null | undefined
): string | undefined {
  const trimmed = userId?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith(`/principal/`)) return trimmed
  const colon = trimmed.indexOf(`:`)
  const principalKey =
    colon > 0 && PRINCIPAL_KEY_PREFIXES.has(trimmed.slice(0, colon))
      ? trimmed
      : `user:${trimmed}`
  return `/principal/${encodeURIComponent(principalKey)}`
}

export function normalizeHeaderRecord(
  value: unknown
): Record<string, string> | null {
  if (!value || typeof value !== `object` || Array.isArray(value)) return null
  const headers = new Headers()
  for (const [rawName, rawValue] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (typeof rawValue !== `string`) continue
    const name = rawName.trim()
    const headerValue = rawValue.trim()
    if (!name || !headerValue) continue
    try {
      headers.set(name, headerValue)
    } catch {
      console.warn(
        `[agents-desktop] settings.json: invalid server header '${rawName}' ignored`
      )
    }
  }
  const normalized = headersToRecord(headers)
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

export function isLocalLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === LOCALHOST_HOST ||
    normalized === LOOPBACK_IPV4_HOST ||
    normalized === `0.0.0.0` ||
    normalized === `[::1]` ||
    normalized === `::1`
  )
}

export function injectDevPrincipalHeaders(
  server: ServerConfig,
  opts: {
    explicitDevPrincipal: string | null
    defaultLocalDevPrincipal: string
  }
): ServerConfig {
  if (server.source === `electric-cloud`) return server
  const principal =
    opts.explicitDevPrincipal ??
    (hasHeader(server.headers, ELECTRIC_PRINCIPAL_HEADER) ||
    hasHeader(server.headers, `authorization`)
      ? null
      : opts.defaultLocalDevPrincipal)
  if (!principal) return server
  return {
    ...server,
    headers: { ...server.headers, [ELECTRIC_PRINCIPAL_HEADER]: principal },
  }
}
