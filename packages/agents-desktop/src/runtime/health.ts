import { URL_PATH_PARSE_BASE } from '../shared/constants'

export type AgentsServerHealthResult =
  | { ok: true }
  | { ok: false; reason: string }

export function buildAgentsServerHealthUrl(baseUrl: string): string {
  try {
    return appendPathToServerUrl(baseUrl, `/_electric/health`)
  } catch {
    const trimmed = baseUrl.replace(/\/+$/, ``)
    return `${trimmed}/_electric/health`
  }
}

export function appendPathToServerUrl(
  baseUrl: string,
  pathName: string
): string {
  const base = new URL(baseUrl)
  const pathUrl = new URL(pathName, URL_PATH_PARSE_BASE)
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  const suffix = pathUrl.pathname.startsWith(`/`)
    ? pathUrl.pathname
    : `/${pathUrl.pathname}`
  const target = new URL(base)
  target.pathname = `${basePath}${suffix}`
  target.search = ``
  target.hash = pathUrl.hash
  base.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  pathUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  return target.toString()
}

export function formatStartupNetworkError(
  error: unknown,
  activeServerUrl: string
): string | null {
  if (!(error instanceof Error)) return null
  if (!/fetch failed/i.test(error.message)) return null
  const cause = (error as Error & { cause?: unknown }).cause
  const details =
    cause && typeof cause === `object` && `code` in cause
      ? String((cause as { code?: unknown }).code ?? ``).trim()
      : ``
  const suffix = details ? ` (${details})` : ``
  return [
    `Could not connect to agents-server at ${activeServerUrl}.`,
    `Make sure it is running, then retry.${suffix}`,
  ].join(` `)
}

export async function checkAgentsServerHealth(
  baseUrl: string,
  timeoutMs: number
): Promise<AgentsServerHealthResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const healthUrl = buildAgentsServerHealthUrl(baseUrl)
  // Auth for cloud-server health checks is added by the global undici
  // interceptor installed by the desktop main process.
  try {
    const res = await fetch(healthUrl, {
      signal: controller.signal,
      headers: { accept: `application/json` },
    })
    if (!res.ok) {
      return {
        ok: false,
        reason: `health check returned ${res.status}`,
      }
    }
    const json = (await res.json()) as { status?: unknown }
    if (json?.status !== `ok`) {
      return {
        ok: false,
        reason: `health check returned an unexpected response`,
      }
    }
    return { ok: true }
  } catch (error) {
    const reason =
      error instanceof Error && error.name === `AbortError`
        ? `health check timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error)
    return { ok: false, reason }
  } finally {
    clearTimeout(timer)
  }
}
