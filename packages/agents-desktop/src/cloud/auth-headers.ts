import { ELECTRIC_PRINCIPAL_HEADER, mergeHeaders } from '../shared/headers'
import type { ServerConfig } from '../shared/types'
import { findCloudServerForUrl, findSavedServerForUrl } from './server-matching'
import type { CloudAuthState } from './cloud-auth'

export type CloudAuthHeaderInjectionDeps = {
  getServers: () => Array<ServerConfig>
  getAgentsToken: (tenantId: string) => string | null | undefined
  getCloudAuthState: () => CloudAuthState | null | undefined
  injectDevPrincipalHeaders: (server: ServerConfig) => ServerConfig
}

export function buildSavedServerHeaders(
  deps: CloudAuthHeaderInjectionDeps,
  url: string
): Record<string, string> | null {
  const server = findSavedServerForUrl(deps.getServers(), url)
  if (!server) return null
  return mergeHeaders(deps.injectDevPrincipalHeaders(server).headers) ?? null
}

/**
 * Build the cloud-auth headers to inject on a request to `url`, or `null` if
 * the URL doesn't target a saved cloud agent server.
 */
export function buildCloudAuthHeaders(
  deps: CloudAuthHeaderInjectionDeps,
  url: string
): Record<string, string> | null {
  const server = findCloudServerForUrl(deps.getServers(), url)
  if (!server || !server.tenantId) return null
  const token = deps.getAgentsToken(server.tenantId)
  if (!token) return null
  const cloudAuthState = deps.getCloudAuthState()
  if (cloudAuthState?.status !== `signed-in` || !cloudAuthState.userId) {
    return null
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    [ELECTRIC_PRINCIPAL_HEADER]: `user:${cloudAuthState.userId}`,
  }
  if (cloudAuthState?.email) {
    headers[`x-electric-asserted-email`] = cloudAuthState.email
  }
  if (cloudAuthState?.name) {
    headers[`x-electric-asserted-name`] = cloudAuthState.name
  }
  return headers
}
