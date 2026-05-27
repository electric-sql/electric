import type { ServerConfig } from '../shared/types'

/**
 * Match a request URL against the user's saved `electric-cloud` servers by
 * host + base path + `service` query marker. Cloud URLs carry
 * `?service=<tenantId>` so a single cloud-agents-server host can serve
 * multiple tenants without us attaching tenant A's token to tenant B's request.
 */
export function findCloudServerForUrl(
  servers: Array<ServerConfig>,
  requestUrl: string
): ServerConfig | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }
  const fallbackMatches: Array<ServerConfig> = []
  const requestedService = parsed.searchParams.get(`service`)
  for (const server of servers) {
    if (server.source !== `electric-cloud`) continue
    if (!server.tenantId) continue
    let base: URL
    try {
      base = new URL(server.url)
    } catch {
      continue
    }
    if (base.origin !== parsed.origin) continue
    const basePath = base.pathname.replace(/\/+$/, ``)
    if (
      basePath !== `` &&
      parsed.pathname !== basePath &&
      !parsed.pathname.startsWith(`${basePath}/`)
    ) {
      continue
    }
    if (requestedService) {
      if (requestedService === server.tenantId) return server
      continue
    }
    fallbackMatches.push(server)
  }
  return fallbackMatches.length === 1 ? fallbackMatches[0]! : null
}

export function findSavedServerForUrl(
  servers: Array<ServerConfig>,
  requestUrl: string
): ServerConfig | null {
  let parsed: URL
  try {
    parsed = new URL(requestUrl)
  } catch {
    return null
  }

  for (const server of servers) {
    let base: URL
    try {
      base = new URL(server.url)
    } catch {
      continue
    }
    if (base.origin !== parsed.origin) continue
    const basePath = base.pathname.replace(/\/+$/, ``)
    if (
      basePath === `` ||
      parsed.pathname === basePath ||
      parsed.pathname.startsWith(`${basePath}/`)
    ) {
      return server
    }
  }
  return null
}
