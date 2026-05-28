import { session } from 'electron'
import * as undici from 'undici'
import type { Dispatcher } from 'undici'
import type { CloudAuthState } from './cloud-auth'
import { mergeHeaders } from '../shared/headers'
import type { ServerConfig } from '../shared/types'
import { findCloudServerForUrl, findSavedServerForUrl } from './server-matching'

export type CloudAuthHeaderInjectionDeps = {
  getServers: () => Array<ServerConfig>
  getAgentsToken: (tenantId: string) => string | null | undefined
  getCloudAuthState: () => CloudAuthState | null | undefined
  injectDevPrincipalHeaders: (server: ServerConfig) => ServerConfig
}

/**
 * Decorate outgoing requests bound for saved agent servers with configured
 * server headers. Cloud agent servers also receive `Authorization:
 * Bearer <agents token>`.
 */
export function installCloudAuthHeaderInjection(
  deps: CloudAuthHeaderInjectionDeps
): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const extra = mergeHeaders(
      buildSavedServerHeaders(deps, details.url) ?? undefined,
      buildCloudAuthHeaders(deps, details.url) ?? undefined
    )
    if (!extra) {
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    callback({
      requestHeaders: { ...details.requestHeaders, ...extra },
    })
  })

  installCloudAuthUndiciInterceptor(deps)
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
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  const cloudAuthState = deps.getCloudAuthState()
  if (cloudAuthState?.userId) {
    headers[`x-electric-asserted-user-id`] = cloudAuthState.userId
  }
  if (cloudAuthState?.email) {
    headers[`x-electric-asserted-email`] = cloudAuthState.email
  }
  if (cloudAuthState?.name) {
    headers[`x-electric-asserted-name`] = cloudAuthState.name
  }
  return headers
}

function installCloudAuthUndiciInterceptor(
  deps: CloudAuthHeaderInjectionDeps
): void {
  const base = undici.getGlobalDispatcher()
  const composed = base.compose(
    (dispatch): Dispatcher[`dispatch`] =>
      (opts, handler) => {
        const fullUrl = composeRequestUrl(opts.origin, opts.path)
        const extra = fullUrl ? buildCloudAuthHeaders(deps, fullUrl) : null
        if (!extra) return dispatch(opts, handler)
        const lowered: Record<string, string> = {}
        for (const [key, value] of Object.entries(extra)) {
          lowered[key.toLowerCase()] = value
        }
        return dispatch(
          { ...opts, headers: mergeUndiciHeaders(opts.headers, lowered) },
          handler
        )
      }
  )
  undici.setGlobalDispatcher(composed)
}

function composeRequestUrl(
  origin: string | URL | null | undefined,
  path: string | undefined
): string | null {
  if (!origin) return null
  const originStr = typeof origin === `string` ? origin : origin.origin
  if (!originStr) return null
  return `${originStr}${path ?? ``}`
}

function mergeUndiciHeaders(
  existing: Dispatcher.DispatchOptions[`headers`],
  overrides: Record<string, string>
): Record<string, string> {
  const overrideKeysLower = new Set(
    Object.keys(overrides).map((key) => key.toLowerCase())
  )
  const out: Record<string, string> = {}
  const pushPair = (name: string, value: string | undefined): void => {
    if (value === undefined) return
    if (overrideKeysLower.has(name.toLowerCase())) return
    out[name] = value
  }
  if (Array.isArray(existing)) {
    for (let i = 0; i + 1 < existing.length; i += 2) {
      const name = existing[i]
      const value = existing[i + 1]
      if (typeof name === `string` && typeof value === `string`) {
        pushPair(name, value)
      }
    }
  } else if (existing && typeof existing === `object`) {
    for (const [name, value] of Object.entries(
      existing as Record<string, string | Array<string> | undefined>
    )) {
      if (typeof value === `string`) pushPair(name, value)
      else if (Array.isArray(value)) pushPair(name, value.join(`, `))
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    out[name] = value
  }
  return out
}
