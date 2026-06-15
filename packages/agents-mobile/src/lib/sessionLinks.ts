import * as Linking from 'expo-linking'

const WEB_UI_PATH = `__agent_ui`
const SESSION_DEEP_LINK_SCHEME = `electric-agents`
const SESSION_DEEP_LINK_HOST = `open-session`

export function sessionIdFromEntityUrl(entityUrl: string): string {
  return entityUrl.replace(/^\/+/, ``)
}

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

/**
 * App deep link that opens a session directly in the Electric Agents app.
 * Carries the full server base URL (incl. any Cloud tenant prefix) and the
 * server-scoped entity url, both URL-encoded. Host is `open-session` (not
 * `session`) so expo-router doesn't auto-route it to the internal /session
 * screen — a dedicated landing route handles it.
 */
export function sessionAppUrl(serverUrl: string, entityUrl: string): string {
  const server = encodeURIComponent(serverUrl.replace(/\/+$/, ``))
  const entity = encodeURIComponent(sessionIdFromEntityUrl(entityUrl))
  return `${SESSION_DEEP_LINK_SCHEME}://${SESSION_DEEP_LINK_HOST}?server=${server}&entity=${entity}`
}

/**
 * Loose match for "is this our open-session deep link?". Accepts both
 * `electric-agents://open-session` and the single-slash Android variant
 * `electric-agents:/open-session` (the OS occasionally collapses the slashes),
 * mirroring `cloudAuth.isCallbackUrl`.
 */
export function isSessionDeepLink(url: string): boolean {
  if (typeof url !== `string`) return false
  const prefix = `${SESSION_DEEP_LINK_SCHEME}:`
  if (!url.startsWith(prefix)) return false
  const rest = url.slice(prefix.length).replace(/^\/+/, ``)
  return rest.startsWith(SESSION_DEEP_LINK_HOST)
}

export function parseSessionDeepLink(
  url: string
): { serverUrl: string; entityUrl: string } | null {
  if (!isSessionDeepLink(url)) return null
  let parsed: ReturnType<typeof Linking.parse>
  try {
    parsed = Linking.parse(url)
  } catch {
    return null
  }
  const params = parsed.queryParams ?? {}
  const server = pickString(params.server)
  const entity = pickString(params.entity)
  if (!server || !entity) return null
  return { serverUrl: server, entityUrl: `/${entity.replace(/^\/+/, ``)}` }
}

function pickString(
  value: string | Array<string> | null | undefined
): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === `string` ? value : null
}
