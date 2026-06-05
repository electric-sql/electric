import { session } from 'electron'
import * as undici from 'undici'
import type { Dispatcher } from 'undici'
import { mergeHeaders } from '../shared/headers'
import {
  buildCloudAuthHeaders,
  buildSavedServerHeaders,
  type CloudAuthHeaderInjectionDeps,
} from './auth-headers'
import { logPostInjectionHeaders } from './auth-debug'
export type { CloudAuthHeaderInjectionDeps } from './auth-headers'

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
      logPostInjectionHeaders({
        transport: `webRequest`,
        method: details.method,
        url: details.url,
        headers: details.requestHeaders,
      })
      callback({ requestHeaders: details.requestHeaders })
      return
    }
    const requestHeaders = { ...details.requestHeaders, ...extra }
    logPostInjectionHeaders({
      transport: `webRequest`,
      method: details.method,
      url: details.url,
      headers: requestHeaders,
    })
    callback({
      requestHeaders,
    })
  })

  installCloudAuthUndiciInterceptor(deps)
}

function installCloudAuthUndiciInterceptor(
  deps: CloudAuthHeaderInjectionDeps
): void {
  const base = undici.getGlobalDispatcher()
  const composed = base.compose(
    (dispatch): Dispatcher[`dispatch`] =>
      (opts, handler) => {
        const fullUrl = composeRequestUrl(opts.origin, opts.path)
        if (!fullUrl) return dispatch(opts, handler)
        const extra = buildCloudAuthHeaders(deps, fullUrl)
        if (!extra) {
          logPostInjectionHeaders({
            transport: `undici`,
            method: opts.method,
            url: fullUrl,
            headers: mergeUndiciHeaders(opts.headers, {}),
          })
          return dispatch(opts, handler)
        }
        const lowered: Record<string, string> = {}
        for (const [key, value] of Object.entries(extra)) {
          lowered[key.toLowerCase()] = value
        }
        const headers = mergeUndiciHeaders(opts.headers, lowered)
        logPostInjectionHeaders({
          transport: `undici`,
          method: opts.method,
          url: fullUrl,
          headers,
        })
        return dispatch({ ...opts, headers }, handler)
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
