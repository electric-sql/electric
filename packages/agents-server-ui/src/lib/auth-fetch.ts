export type AssertedAuthHeaders = Record<string, string>

type ServerHeaderConfig = {
  name?: string
  url: string
  headers?: Record<string, string>
}

type ActiveServerHeaders = {
  baseUrl: string
  headers: Record<string, string>
}

let activeServerHeaders: ActiveServerHeaders | null = null

function normalizeHeaders(
  headers: Record<string, string> | undefined
): Record<string, string> {
  if (!headers) return {}
  const normalized = new Headers()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim()
    const value = rawValue.trim()
    if (!name || !value) continue
    try {
      normalized.set(name, value)
    } catch {
      // Ignore persisted or hand-edited invalid header entries.
    }
  }
  return Object.fromEntries(normalized.entries())
}

function urlFromInput(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === `string` || input instanceof URL) {
      return new URL(input, globalThis.location?.href)
    }
    return new URL(input.url, globalThis.location?.href)
  } catch {
    return null
  }
}

function normalizeBasePath(pathname: string): string {
  if (pathname === `/`) return ``
  return pathname.replace(/\/+$/, ``)
}

function matchesActiveServer(input: RequestInfo | URL): boolean {
  if (!activeServerHeaders) return false
  const requestUrl = urlFromInput(input)
  if (!requestUrl) return false

  let baseUrl: URL
  try {
    baseUrl = new URL(activeServerHeaders.baseUrl)
  } catch {
    return false
  }

  if (requestUrl.origin !== baseUrl.origin) return false
  const basePath = normalizeBasePath(baseUrl.pathname)
  if (!basePath) return true
  return (
    requestUrl.pathname === basePath ||
    requestUrl.pathname.startsWith(`${basePath}/`)
  )
}

export function registerActiveServerHeaders(
  server: ServerHeaderConfig | null
): void {
  const headers = normalizeHeaders(server?.headers)
  activeServerHeaders =
    server && Object.keys(headers).length > 0
      ? { baseUrl: server.url, headers }
      : null
}

export function getConfiguredServerHeaders(
  input: RequestInfo | URL
): Record<string, string> {
  return matchesActiveServer(input) ? (activeServerHeaders?.headers ?? {}) : {}
}

export async function getDesktopAssertedAuthHeaders(): Promise<AssertedAuthHeaders> {
  if (typeof window === `undefined`) return {}
  return (await window.electronAPI?.getAssertedAuthHeaders?.()) ?? {}
}

export async function serverFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const assertedHeaders = await getDesktopAssertedAuthHeaders()
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined
  )
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })
  for (const [key, value] of Object.entries(
    getConfiguredServerHeaders(input)
  )) {
    if (!headers.has(key)) headers.set(key, value)
  }
  for (const [key, value] of Object.entries(assertedHeaders)) {
    if (!headers.has(key)) headers.set(key, value)
  }
  return fetch(input, { ...init, headers })
}
