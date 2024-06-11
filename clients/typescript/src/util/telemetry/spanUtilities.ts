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
  isClientRequest?: boolean
}

function startSpan(
  name: string,
  { parentSpan, attributes, isClientRequest }: SpanOptions = {}
) {
  return getTracer().startSpan(
    name,
    {
      kind: isClientRequest ? SpanKind.CLIENT : SpanKind.INTERNAL,
      attributes,
    },
    parentSpan && trace.setSpan(context.active(), parentSpan)
  )
}

function runWithSpan<T>(name: string, options: SpanOptions, fn: () => T): T
function runWithSpan<T>(name: string, fn: () => T): T
function runWithSpan<T>(
  name: string,
  fnOrOptions: SpanOptions | (() => T),
  fn?: () => T
) {
  const span = startSpan(name)
  const functionToTrace = (
    typeof fnOrOptions === 'function' ? fnOrOptions : fn
  ) as () => T
  try {
    const result = functionToTrace()

    // if result is a promise, chain span actions to it
    if (result instanceof Promise) {
      result
        .then((_) => span.setStatus({ code: SpanStatusCode.OK }))
        .catch((err) => {
          span.recordException(err)
          span.setStatus({ code: SpanStatusCode.ERROR })
        })
        .finally(() => span.end())
      return result
    }

    // if result is not a promise, handle in try..catch
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (err: any) {
    span.recordException(err)
    span.setStatus({ code: SpanStatusCode.ERROR })
    throw err
  } finally {
    span.end()
  }
}

export { startSpan, runWithSpan }
export type { Span }
