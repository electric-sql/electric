/**
 * Wire format for `electric-agents://open-session` deep links — the single
 * source of truth shared by the desktop (Electron), mobile (Expo/RN) and
 * web (agents-server-ui) apps. The encode/decode contract here IS the link
 * format: if the build and parse sides ever drift links silently stop
 * round-tripping, so both live in one module that every app re-exports.
 *
 * Parsing is intentionally done with plain string ops rather than `new URL`
 * or `expo-linking`: those APIs are incomplete or behave differently across
 * Node, browsers and React Native (RN's `URL` notably mangles custom
 * schemes), whereas the query string we emit is simple and fully under our
 * control. This also transparently handles the single-slash Android variant
 * (`electric-agents:/open-session?…`) the OS occasionally produces.
 */

const SESSION_DEEP_LINK_SCHEME = `electric-agents`
const SESSION_DEEP_LINK_HOST = `open-session`

export type ParsedSessionDeepLink = {
  serverUrl: string
  entityUrl: string
}

export function sessionIdFromEntityUrl(entityUrl: string): string {
  return entityUrl.replace(/^\/+/, ``)
}

/**
 * App deep link that opens a session directly in the Electric Agents app.
 * Carries the full server base URL (incl. any Cloud tenant prefix like
 * `/t/<service-id>/v1`) and the server-scoped entity url, both URL-encoded.
 * Host is `open-session` (not `session`) so expo-router doesn't auto-route
 * it to the internal `/session` screen — a dedicated landing route handles it.
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
 * mirroring `cloudAuth.isCallbackUrl`. The host is matched on a boundary —
 * it must be followed by `?`, `/`, or end of string — so a future
 * `electric-agents://open-session-foo` host can never be mistaken for ours.
 */
export function isSessionDeepLink(url: string): boolean {
  if (typeof url !== `string`) return false
  const prefix = `${SESSION_DEEP_LINK_SCHEME}:`
  if (!url.startsWith(prefix)) return false
  const rest = url.slice(prefix.length).replace(/^\/+/, ``)
  if (!rest.startsWith(SESSION_DEEP_LINK_HOST)) return false
  const boundary = rest.charAt(SESSION_DEEP_LINK_HOST.length)
  return boundary === `` || boundary === `?` || boundary === `/`
}

export function parseSessionDeepLink(
  url: string
): ParsedSessionDeepLink | null {
  if (!isSessionDeepLink(url)) return null
  const queryStart = url.indexOf(`?`)
  if (queryStart === -1) return null
  const params = parseQueryString(url.slice(queryStart + 1))
  const server = params.server
  const entity = params.entity
  if (!server || !entity) return null
  return { serverUrl: server, entityUrl: `/${entity.replace(/^\/+/, ``)}` }
}

/**
 * Pull an `electric-agents://open-session?…` URL out of a process argv array.
 * On Windows/Linux the OS delivers deep links as a command-line argument
 * (cold start in `process.argv`, warm start via the `second-instance` event).
 */
export function extractSessionDeepLinkFromArgv(
  argv: ReadonlyArray<string>
): string | null {
  for (const arg of argv) {
    if (isSessionDeepLink(arg)) return arg
  }
  return null
}

function parseQueryString(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of query.split(`&`)) {
    if (pair === ``) continue
    const eq = pair.indexOf(`=`)
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? `` : pair.slice(eq + 1)
    const key = safeDecodeComponent(rawKey)
    // First value wins, matching the prior `URLSearchParams.get` / array[0]
    // behaviour when a param is repeated.
    if (Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = safeDecodeComponent(rawValue)
  }
  return out
}

function safeDecodeComponent(value: string): string {
  try {
    // `+` as a space matches the `application/x-www-form-urlencoded` reading
    // the previous `new URL().searchParams` path applied on desktop/web.
    return decodeURIComponent(value.replace(/\+/g, ` `))
  } catch {
    return value
  }
}
