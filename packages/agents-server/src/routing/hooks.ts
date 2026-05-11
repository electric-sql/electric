import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { apiError } from '../electric-agents-http.js'
import { ElectricAgentsError } from '../entity-manager.js'
import { ATTR, extractTraceContext, tracer } from '../tracing.js'
import { serverLog } from '../utils/log.js'
import type { Span } from '@opentelemetry/api'
import type { IRequest } from 'itty-router'
import type { TenantContext } from './context.js'

const SPAN_KEY = Symbol(`agents-server.otel-span`)

interface SpanCarrier {
  [SPAN_KEY]?: Span
}

function headersRecord(
  headers: Headers
): Record<string, string | Array<string> | undefined> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    out[key] = value
  })
  return out
}

function carrier(req: IRequest): IRequest & SpanCarrier {
  return req as IRequest & SpanCarrier
}

export function startRequestSpan(req: IRequest, ctx: TenantContext): Span {
  const existing = carrier(req)[SPAN_KEY]
  if (existing) return existing

  const url = new URL(req.url)
  const parentCtx = extractTraceContext(headersRecord(req.headers))
  const span = tracer.startSpan(
    `HTTP ${req.method}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        [ATTR.HTTP_METHOD]: req.method,
        [ATTR.HTTP_ROUTE]: url.pathname,
        'electric_agents.tenant_id': ctx.service,
      },
    },
    parentCtx
  )

  carrier(req)[SPAN_KEY] = span
  return span
}

export function otelStartSpan(req: IRequest, ctx: TenantContext): undefined {
  startRequestSpan(req, ctx)
  return undefined
}

export function otelEndSpan(
  response: Response | undefined,
  req: IRequest
): void {
  const span = carrier(req)[SPAN_KEY]
  if (!span) return
  if (response) {
    span.setAttribute(ATTR.HTTP_STATUS, response.status)
  }
  span.end()
  carrier(req)[SPAN_KEY] = undefined
}

export function applyCors(
  response: Response | undefined
): Response | undefined {
  if (!response) return response
  const headers = new Headers(response.headers)
  headers.set(`access-control-allow-origin`, `*`)
  headers.set(
    `access-control-allow-methods`,
    `GET, POST, PUT, PATCH, DELETE, OPTIONS`
  )
  headers.set(
    `access-control-allow-headers`,
    `content-type, authorization, ngrok-skip-browser-warning`
  )
  headers.set(`access-control-expose-headers`, `*`)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function preflightCors(req: IRequest): Response | undefined {
  if (req.method !== `OPTIONS`) return undefined
  return new Response(null, { status: 204 })
}

export function errorMapper(err: unknown, req: IRequest): Response {
  const span = carrier(req)[SPAN_KEY]
  if (err instanceof Error) {
    span?.recordException(err)
    span?.setStatus({ code: SpanStatusCode.ERROR, message: err.message })
  }
  if (err instanceof ElectricAgentsError) {
    return apiError(err.status, err.code, err.message, err.details)
  }
  serverLog.error(`[agent-server] Unhandled error:`, err)
  return apiError(500, `INTERNAL_SERVER_ERROR`, `Internal server error`)
}

export function rejectIfShuttingDown(
  req: IRequest,
  ctx: TenantContext
): Response | undefined {
  if (!ctx.isShuttingDown()) return undefined
  const path = new URL(req.url).pathname
  if (!path.startsWith(`/_electric/webhook-forward/`)) return undefined
  return apiError(503, `SERVER_STOPPING`, `Server is shutting down`)
}

export function getRequestSpan(req: IRequest): Span | undefined {
  return carrier(req)[SPAN_KEY]
}
