const SESSION_DEEP_LINK_SCHEME = `electric-agents`
const SESSION_DEEP_LINK_HOST = `open-session`

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
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const server = parsed.searchParams.get(`server`)
  const entity = parsed.searchParams.get(`entity`)
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
