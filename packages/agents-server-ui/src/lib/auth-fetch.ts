import type {
  DesktopServerFetchRequest,
  DesktopServerFetchResponse,
} from './server-connection'

type ServerHeaderConfig = {
  name?: string
  url: string
  headers?: Record<string, string>
}

type ActiveServerHeaders = {
  baseUrl: string
  headers: Record<string, string>
}

const DEFAULT_ACTIVE_PRINCIPAL = `system:dev-local`
const DESKTOP_SERVER_FETCH_METHODS = new Set([`POST`, `PUT`, `PATCH`, `DELETE`])
const NULL_BODY_STATUSES = new Set([204, 205, 304])

let activeServerHeaders: ActiveServerHeaders | null = null

function principalUrl(principal: string): string {
  const trimmed = principal.trim()
  return trimmed.startsWith(`/principal/`)
    ? trimmed
    : `/principal/${encodeURIComponent(trimmed)}`
}

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
    } catch (err) {
      console.warn(
        `[auth-fetch] Dropping invalid header "${name}":`,
        err instanceof Error ? err.message : String(err)
      )
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

function isLocalHttpUrl(url: URL): boolean {
  if (url.protocol !== `http:`) return false
  const hostname = url.hostname.toLowerCase()
  return (
    hostname === `localhost` ||
    hostname === `127.0.0.1` ||
    hostname === `0.0.0.0` ||
    hostname === `[::1]` ||
    hostname === `::1`
  )
}

function activeServerIsLocal(): boolean {
  if (!activeServerHeaders) return false
  try {
    return isLocalHttpUrl(new URL(activeServerHeaders.baseUrl))
  } catch {
    return false
  }
}

function requestMethod(input: RequestInfo | URL, init: RequestInit): string {
  return (
    init.method ??
    (input instanceof Request ? input.method : undefined) ??
    `GET`
  ).toUpperCase()
}

function desktopServerFetchApi():
  | ((
      request: DesktopServerFetchRequest
    ) => Promise<DesktopServerFetchResponse>)
  | undefined {
  if (typeof window === `undefined`) return undefined
  return window.electronAPI?.serverFetch
}

function shouldUseDesktopServerFetch(
  input: RequestInfo | URL,
  init: RequestInit
): boolean {
  const method = requestMethod(input, init)
  return (
    DESKTOP_SERVER_FETCH_METHODS.has(method) &&
    activeServerIsLocal() &&
    matchesActiveServer(input) &&
    Boolean(desktopServerFetchApi())
  )
}

async function desktopFetchBody(
  input: RequestInfo | URL,
  init: RequestInit
): Promise<string | null | undefined> {
  if (init.body === undefined || init.body === null) {
    if (input instanceof Request) {
      if (input.bodyUsed) return undefined
      return await input.clone().text()
    }
    return null
  }
  if (typeof init.body === `string`) return init.body
  if (init.body instanceof URLSearchParams) return init.body.toString()
  if (init.body instanceof Blob) return await init.body.text()
  return undefined
}

function responseFromDesktopFetch(
  response: DesktopServerFetchResponse
): Response {
  const body = NULL_BODY_STATUSES.has(response.status) ? null : response.body
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
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

export function getConfiguredActivePrincipal(): string | null {
  const principal = activeServerHeaders?.headers[`electric-principal`]
  return principal ? principalUrl(principal) : null
}

export function getActivePrincipal(): string {
  return (
    getConfiguredActivePrincipal() ?? principalUrl(DEFAULT_ACTIVE_PRINCIPAL)
  )
}

function hasDesktopHeaderInjection(): boolean {
  return (
    typeof window !== `undefined` &&
    Boolean((window as { electronAPI?: unknown }).electronAPI)
  )
}

export async function serverFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = requestMethod(input, init)
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined
  )
  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })
  if (!hasDesktopHeaderInjection()) {
    for (const [key, value] of Object.entries(
      getConfiguredServerHeaders(input)
    )) {
      if (!headers.has(key)) headers.set(key, value)
    }
  }
  if (shouldUseDesktopServerFetch(input, init)) {
    const api = desktopServerFetchApi()
    const url = urlFromInput(input)
    const body = await desktopFetchBody(input, init)
    if (api && url && body !== undefined) {
      return responseFromDesktopFetch(
        await api({
          url: url.toString(),
          method,
          headers: Object.fromEntries(headers.entries()),
          body,
        })
      )
    }
  }
  return fetch(input, { ...init, headers })
}
