import { SpanStatusCode, context, propagation, trace } from '@opentelemetry/api'
import type { Context, Span, SpanOptions, Tracer } from '@opentelemetry/api'

export const tracer: Tracer = trace.getTracer(`agent-server`)

export const ATTR = {
  ENTITY_URL: `electric_agents.entity.url`,
  ENTITY_TYPE: `electric_agents.entity.type`,
  PARENT_URL: `electric_agents.entity.parent`,
  WAKE_SOURCE: `electric_agents.wake.source`,
  WAKE_SUBSCRIBER: `electric_agents.wake.subscriber`,
  WAKE_KIND: `electric_agents.wake.kind`,
  STREAM_PATH: `electric_agents.stream.path`,
  STREAM_OP: `electric_agents.stream.op`,
  DB_OP: `electric_agents.db.op`,
  HTTP_METHOD: `http.method`,
  HTTP_ROUTE: `http.route`,
  HTTP_STATUS: `http.status_code`,
} as const

/**
 * Run `fn` inside an active span. Errors are recorded + status set to ERROR,
 * then re-thrown. Span ends in a finally block.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  opts?: SpanOptions
): Promise<T> {
  return await tracer.startActiveSpan(name, opts ?? {}, async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      span.end()
    }
  })
}

export function injectTraceHeaders(
  headers: Record<string, string>,
  ctx: Context = context.active()
): void {
  propagation.inject(ctx, headers)
}

export function extractTraceContext(
  headers: Record<string, string | Array<string> | undefined>
): Context {
  return propagation.extract(context.active(), headers)
}
