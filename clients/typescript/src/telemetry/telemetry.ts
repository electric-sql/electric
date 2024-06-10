import { Context, context, trace, Span } from '@opentelemetry/api'
import {
  ConsoleSpanExporter,
  WebTracerProvider,
  SimpleSpanProcessor,
  StackContextManager,
} from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  Tracer,
} from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { LIB_VERSION } from '../version'

interface TelemetryConfig {
  debug?: boolean
}

let _TELEMETRY_PROVIDER: BasicTracerProvider | null = null

const setUpTelemetry = ({ debug }: TelemetryConfig): BasicTracerProvider => {
  if (_TELEMETRY_PROVIDER !== null) {
    throw new Error('Telemetry already initialized')
  }

  const provider = new WebTracerProvider({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: `electric:client:typescript`,
      [SEMRESATTRS_SERVICE_VERSION]: LIB_VERSION,
    }),
  })

  if (debug) {
    provider.addSpanProcessor(
      new SimpleSpanProcessor(new ConsoleSpanExporter())
    )
  }

  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))

  provider.register({
    contextManager: new StackContextManager(),
  })

  _TELEMETRY_PROVIDER = provider
  return _TELEMETRY_PROVIDER
}

const getTelemetryProvider = (): BasicTracerProvider => {
  if (_TELEMETRY_PROVIDER === null) {
    throw new Error('Telemetry not initialized')
  }
  return _TELEMETRY_PROVIDER
}

const getTracer = (): Tracer => {
  return getTelemetryProvider().getTracer('electric-client')
}

const getSpanContextWithParent = (parentSpan: Span): Context => {
  return trace.setSpan(context.active(), parentSpan)
}

const shutDownTelemetry = async (): Promise<void> => {
  await getTelemetryProvider().shutdown()
  _TELEMETRY_PROVIDER = null
}

export {
  setUpTelemetry,
  getTracer,
  getSpanContextWithParent,
  shutDownTelemetry,
}
export type { TelemetryConfig }
