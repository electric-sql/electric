/**
 * Proxies GET requests under /_electric/electric/* to the configured Electric
 * SQL HTTP API.
 */

import { Router } from 'itty-router'
import { apiError, responseHeaders } from '../electric-agents-http.js'
import { buildElectricProxyTarget } from '../utils/server-utils.js'
import type { IRequest, RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

export type ElectricProxyRoutes = RouterType<
  IRequest,
  [TenantContext],
  Response | undefined
>

export const electricProxyRouter: ElectricProxyRoutes = Router<
  IRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/_electric/electric`,
})

electricProxyRouter.get(`/*`, proxyElectric)

async function proxyElectric(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  if (!ctx.electricUrl) {
    return apiError(500, `ELECTRIC_PROXY_FAILED`, `Electric URL not configured`)
  }

  const target = buildElectricProxyTarget({
    incomingUrl: new URL(request.url),
    electricUrl: ctx.electricUrl,
    electricSecret: ctx.electricSecret,
    tenantId: ctx.service,
  })
  const headers = new Headers(request.headers)
  headers.delete(`host`)

  let upstream: Response
  try {
    upstream = await fetch(target, { method: request.method, headers })
  } catch (err) {
    return apiError(
      502,
      `ELECTRIC_PROXY_FAILED`,
      err instanceof Error ? err.message : String(err)
    )
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  })
}
