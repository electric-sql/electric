import { findSavedServerForUrl } from '../cloud/server-matching'
import { parseSessionDeepLink } from './deep-link'
import type { OpenSessionPayload, ServerConfig } from './types'

/**
 * Resolve an `electric-agents://open-session?…` deep link into the payload the
 * renderer needs to open the session: the parsed server/entity plus the id of
 * the matching saved server (or `null` when the link points at a server the
 * user hasn't added). Returns `null` for a malformed link.
 *
 * Pure (no Electron/window state) so the server-matching branch — the part
 * most likely to regress — is unit-testable in isolation.
 */
export function resolveOpenSessionPayload(
  servers: Array<ServerConfig>,
  url: string
): OpenSessionPayload | null {
  const parsed = parseSessionDeepLink(url)
  if (!parsed) return null
  const matched = findSavedServerForUrl(servers, parsed.serverUrl)
  return {
    serverId: matched?.id ?? null,
    serverUrl: parsed.serverUrl,
    entityUrl: parsed.entityUrl,
  }
}
