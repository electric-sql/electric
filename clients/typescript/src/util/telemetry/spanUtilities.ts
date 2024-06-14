import { getTracer } from './telemetry'
import {
  Span,
  Attributes,
  context,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'

interface SpanOptions {
  parentSpan?: Span
  attributes?: Attributes
  isClientSpan?: boolean
}

function startSpan(
  name: string,
  { parentSpan, attributes, isClientSpan }: SpanOptions = {}
) {
  return getTracer().startSpan(
    name,
    {
      kind: isClientSpan ? SpanKind.CLIENT : SpanKind.INTERNAL,
      attributes,
    },
    parentSpan && trace.setSpan(context.active(), parentSpan)
  )
}

/**
 * Sets the span status to `ERROR` and optinally records the provided error
 * ass an exception
 */
function recordSpanError(span: Span, error?: any) {
  span.recordException(error)
  span.setStatus({ code: SpanStatusCode.ERROR, message: error?.message })
}

/**
 * Run provided function `fn` with the given span, which will start before
 * the function execution and end after the function returns, marking its state
 * as either failed or succeeded appropriately and recording exceptions
 */
function runWithSpan<T>(
  name: string,
  options: SpanOptions,
  fn: (span: Span) => T
): T
function runWithSpan<T>(name: string, fn: (span: Span) => T): T
function runWithSpan<T>(
  name: string,
  fnOrOptions: SpanOptions | ((span: Span) => T),
  fn?: (span: Span) => T
) {
  const span = startSpan(name)
  const functionToTrace = (
    typeof fnOrOptions === 'function' ? fnOrOptions : fn
  ) as (span: Span) => T
  try {
    const result = functionToTrace(span)

    // if result is a promise, chain span actions to it
    if (result instanceof Promise) {
      result
        .then((_) => span.setStatus({ code: SpanStatusCode.OK }))
        .catch((err) => recordSpanError(span, err))
        .finally(() => span.end())
      return result
    }

    // if result is not a promise, handle in try..catch
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err: any) {
    recordSpanError(span, err)
    throw err
  } finally {
    span.end()
  }
}

export { startSpan, runWithSpan, recordSpanError }
export type { Span }
