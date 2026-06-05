import {
  headersToRecord,
  isLocalLoopbackHostname,
  mergeHeaders,
  normalizeHeaderRecord,
} from '../shared/headers'
import type {
  DesktopServerFetchRequest,
  DesktopServerFetchResponse,
} from '../shared/types'
import {
  buildCloudAuthHeaders,
  buildSavedServerHeaders,
  type CloudAuthHeaderInjectionDeps,
} from './auth-headers'
import { logPostInjectionHeaders } from './auth-debug'
import { findSavedServerForUrl } from './server-matching'

export type DesktopServerFetchDeps = CloudAuthHeaderInjectionDeps

function assertDesktopServerFetchAllowed(
  deps: DesktopServerFetchDeps,
  request: unknown
): DesktopServerFetchRequest {
  if (!request || typeof request !== `object`) {
    throw new Error(`Invalid desktop server fetch request`)
  }
  const raw = request as Partial<DesktopServerFetchRequest>
  if (typeof raw.url !== `string` || raw.url.trim().length === 0) {
    throw new Error(`Invalid desktop server fetch URL`)
  }
  if (typeof raw.method !== `string` || raw.method.trim().length === 0) {
    throw new Error(`Invalid desktop server fetch method`)
  }
  if (!raw.headers || typeof raw.headers !== `object`) {
    throw new Error(`Invalid desktop server fetch headers`)
  }
  if (raw.body !== null && typeof raw.body !== `string`) {
    throw new Error(`Invalid desktop server fetch body`)
  }

  const url = raw.url.trim()
  const method = raw.method.trim().toUpperCase()
  if (![`POST`, `PUT`, `PATCH`, `DELETE`].includes(method)) {
    throw new Error(`Desktop server fetch only supports mutating requests`)
  }
  const server = findSavedServerForUrl(deps.getServers(), url)
  if (!server) {
    throw new Error(
      `Desktop server fetch is only available for saved local servers`
    )
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid desktop server fetch URL`)
  }
  if (
    parsed.protocol !== `http:` ||
    !isLocalLoopbackHostname(parsed.hostname)
  ) {
    throw new Error(`Desktop server fetch only supports local HTTP servers`)
  }

  return {
    url,
    method,
    headers: normalizeHeaderRecord(raw.headers) ?? {},
    body: raw.body,
  }
}

export async function desktopServerFetch(
  deps: DesktopServerFetchDeps,
  request: unknown
): Promise<DesktopServerFetchResponse> {
  const checked = assertDesktopServerFetchAllowed(deps, request)
  const cloudHeaders = buildCloudAuthHeaders(deps, checked.url)
  const headers = mergeHeaders(
    buildSavedServerHeaders(deps, checked.url) ?? undefined,
    checked.headers,
    cloudHeaders ?? undefined
  )
  if (!headers) throw new Error(`No headers available for desktop server fetch`)
  logPostInjectionHeaders({
    transport: `desktop-server-fetch`,
    method: checked.method,
    url: checked.url,
    headers,
  })
  const response = await fetch(checked.url, {
    method: checked.method,
    headers,
    body: checked.body,
  })
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    body: await response.text(),
  }
}
