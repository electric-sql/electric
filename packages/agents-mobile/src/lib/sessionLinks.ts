import { sessionIdFromEntityUrl } from '@electric-ax/agents-runtime/session-links'

const WEB_UI_PATH = `__agent_ui`

// The app deep-link format (build/parse/match) is shared across the desktop,
// mobile and web apps so the wire format can never drift. Re-exported here so
// existing imports from `./sessionLinks` keep working.
export {
  sessionIdFromEntityUrl,
  sessionAppUrl,
  isSessionDeepLink,
  parseSessionDeepLink,
} from '@electric-ax/agents-runtime/session-links'

/**
 * Browser-openable link to a session in the server's bundled web UI.
 * Targets `/__agent_ui/` directly rather than the server root: the root
 * 302 redirect uses an absolute path, which would drop a Cloud tenant
 * prefix like `/t/<service-id>/v1`. The session id stays un-encoded to
 * match the web UI's hash splat route (`/entity/$`).
 */
export function sessionWebUrl(serverUrl: string, entityUrl: string): string {
  const id = sessionIdFromEntityUrl(entityUrl)
  let base: string
  try {
    const parsed = new URL(serverUrl)
    const prefix = parsed.pathname.replace(/\/+$/, ``)
    base = `${parsed.origin}${prefix}`
  } catch {
    base = serverUrl.replace(/\/+$/, ``)
  }
  return `${base}/${WEB_UI_PATH}/#/entity/${id}`
}
