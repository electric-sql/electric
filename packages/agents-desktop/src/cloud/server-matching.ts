import type { ServerConfig } from '../shared/types'

/**
 * Match a request URL against the user's saved `electric-cloud` servers by
 * host + base path. Cloud URLs include `/t/<tenantId>/v1` so a single
 * cloud-agents-server host can serve multiple tenants without us attaching
 * tenant A's token to tenant B's request.
 *
 * Legacy settings may still have a host-only Cloud URL. We allow a host-only
 * request match only when it is the sole possible fallback; otherwise
 * tenant-scoped base paths win.
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
  let bestPathMatch: { server: ServerConfig; pathLength: number } | null = null
  const hostOnlyMatches: Array<ServerConfig> = []
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
    if (basePath === ``) {
      hostOnlyMatches.push(server)
      continue
    }
    if (
      parsed.pathname === basePath ||
      parsed.pathname.startsWith(`${basePath}/`)
    ) {
      if (!bestPathMatch || basePath.length > bestPathMatch.pathLength) {
        bestPathMatch = { server, pathLength: basePath.length }
      }
    }
  }
  if (bestPathMatch) return bestPathMatch.server
  return hostOnlyMatches.length === 1 ? hostOnlyMatches[0]! : null
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
