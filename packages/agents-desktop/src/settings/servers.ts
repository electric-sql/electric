import { randomUUID } from 'node:crypto'
import { normalizeHeaderRecord } from '../shared/headers'
import type {
  ServerConfig,
  ServerDesiredState,
  ServerSource,
} from '../shared/types'

export function normalizeServer(
  value: unknown,
  opts: {
    activeUrl?: string | null
    defaultDesiredState?: ServerDesiredState
  } = {}
): ServerConfig | null {
  if (!value || typeof value !== `object`) return null
  const maybe = value as Partial<ServerConfig>
  if (typeof maybe.name !== `string` || typeof maybe.url !== `string`) {
    return null
  }
  const name = maybe.name.trim()
  const url = maybe.url.trim()
  if (!name || !url) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  const id =
    typeof maybe.id === `string` && maybe.id.trim()
      ? maybe.id.trim()
      : randomUUID()
  const source: ServerSource =
    maybe.source === `local-discovery` || maybe.source === `electric-cloud`
      ? maybe.source
      : `manual`
  const desiredState: ServerDesiredState =
    maybe.desiredState === `connected` || maybe.desiredState === `disconnected`
      ? maybe.desiredState
      : url === opts.activeUrl
        ? `connected`
        : (opts.defaultDesiredState ?? `disconnected`)
  const localRuntimeEnabled = maybe.localRuntimeEnabled !== false
  const headers = normalizeHeaderRecord(maybe.headers)
  const tenantId =
    source === `electric-cloud` &&
    typeof maybe.tenantId === `string` &&
    maybe.tenantId.trim().length > 0
      ? maybe.tenantId.trim()
      : undefined
  return {
    id,
    name,
    url,
    source,
    desiredState,
    localRuntimeEnabled,
    ...(headers ? { headers } : {}),
    ...(tenantId ? { tenantId } : {}),
  }
}

export function normalizeServers(
  value: unknown,
  activeUrl?: string | null
): Array<ServerConfig> {
  if (!Array.isArray(value)) return []
  const byUrl = new Map<string, ServerConfig>()
  for (const entry of value) {
    const server = normalizeServer(entry, { activeUrl })
    if (server) byUrl.set(server.url, server)
  }
  return [...byUrl.values()]
}

export function serverInList(
  server: ServerConfig | null,
  servers: Array<ServerConfig>
): boolean {
  return Boolean(
    server &&
      servers.some(
        (entry) => entry.id === server.id || entry.url === server.url
      )
  )
}
