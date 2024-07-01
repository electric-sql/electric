import { getTracer, TracePropagationData } from './telemetry'
import {
  Span,
  Attributes,
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  propagation,
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
  const span = getTracer().startSpan(
    name,
    {
      kind: isClientSpan ? SpanKind.CLIENT : SpanKind.INTERNAL,
      attributes,
    },
    parentSpan && trace.setSpan(context.active(), parentSpan)
  )
  return span
}

/**
 * Sets the span status to `ERROR` and optionally records the provided error
 * as an exception
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
  const spanOptions = typeof fnOrOptions === 'function' ? {} : fnOrOptions
  const span = startSpan(name, spanOptions)
  const functionToTrace = (
    typeof fnOrOptions === 'function' ? fnOrOptions : fn
  ) as (span: Span) => T
  try {
    const result = context.with(trace.setSpan(context.active(), span), () =>
      functionToTrace(span)
    )

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

const getSpanTracePropagationData = (span: Span): TracePropagationData => {
  const output: Partial<TracePropagationData> = {}

  // Serialize the traceparent and tracestate from context into
  // an output object.
  propagation.inject(
    trace.setSpanContext(context.active(), span.spanContext()),
    output
  )

  return output as TracePropagationData
}

export { startSpan, runWithSpan, recordSpanError, getSpanTracePropagationData }
export type { Span, TracePropagationData }
