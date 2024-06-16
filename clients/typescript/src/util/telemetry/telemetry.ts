import 'path'
import { SpanContext, context, propagation, trace } from '@opentelemetry/api'
import {
  ConsoleSpanExporter,
  WebTracerProvider,
  SimpleSpanProcessor,
  StackContextManager,
} from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor, Tracer } from '@opentelemetry/sdk-trace-base'
import { Resource } from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { LIB_VERSION } from '../../version'

const tracerName = 'electric-client' as const

interface TelemetryConfig {
  logToConsole?: boolean
  exportToOTLP?: boolean
  OTLPEndpoint?: string
}

const provider = new WebTracerProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: `electric:client:typescript`,
    [SEMRESATTRS_SERVICE_VERSION]: LIB_VERSION,
  }),
})

provider.register({
  contextManager: new StackContextManager(),
})

let consoleExporterAdded = false
const addConsoleExporter = () => {
  if (consoleExporterAdded) return
  provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
  consoleExporterAdded = true
}

let otlpExporterAddded = false
const addOTLPExporter = (endpoint?: string) => {
  if (otlpExporterAddded) return
  let config
  if (endpoint) {
    const url = new URL(endpoint)
    url.pathname += 'v1/traces'
    config = { url: url.toString() }
  }
  const exporter = new OTLPTraceExporter(config)

  provider.addSpanProcessor(
    new BatchSpanProcessor(exporter, { scheduledDelayMillis: 1000 })
  )
  otlpExporterAddded = true
}

const setUpTelemetry = ({
  logToConsole,
  exportToOTLP,
  OTLPEndpoint,
}: TelemetryConfig): void => {
  if (logToConsole) addConsoleExporter()
  if (exportToOTLP) addOTLPExporter(OTLPEndpoint)
}

const getTracer = (): Tracer => {
  return provider.getTracer(tracerName)
}

const disposeTelemetry = async (): Promise<void> => {
  await provider.shutdown()
}

const getTraceParent = (ctx: SpanContext) => {
  const output: { traceparent?: string; tracestate?: string } = {}

  // Serialize the traceparent and tracestate from context into
  // an output object.
  //
  // This example uses the active trace context, but you can
  // use whatever context is appropriate to your scenario.
  propagation.inject(trace.setSpanContext(context.active(), ctx), output)

  return output
}

export { setUpTelemetry, getTracer, getTraceParent, disposeTelemetry }
export type { TelemetryConfig }
