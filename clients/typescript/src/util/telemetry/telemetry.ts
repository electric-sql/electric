import 'path'
import {
  ConsoleSpanExporter,
  WebTracerProvider,
  SimpleSpanProcessor,
  StackContextManager,
} from '@opentelemetry/sdk-trace-web'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { Resource } from '@opentelemetry/resources'
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import { LIB_VERSION } from '../../version'
import {
  context,
  Context,
  propagation,
  trace,
  Tracer,
} from '@opentelemetry/api'

const tracerName = 'electric-client' as const

interface TelemetryConfig {
  logToConsole?: boolean
  exportToOTLP?: boolean
  OTLPEndpoint?: string
}

interface TracePropagationData {
  traceparent: string
  tracestate?: string
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

// Propagation is done using W3C traceparent and tracestate
propagation.setGlobalPropagator(new W3CTraceContextPropagator())

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
  if (logToConsole || exportToOTLP) trace.setGlobalTracerProvider(provider)
  if (logToConsole) addConsoleExporter()
  if (exportToOTLP) addOTLPExporter(OTLPEndpoint)
}

const getTracer = (): Tracer => {
  return trace.getTracer(tracerName)
}

const getActiveContext = (): Context => {
  return context.active()
}

const getActiveTracePropagationData = (): TracePropagationData => {
  const output: Partial<TracePropagationData> = {}
  propagation.inject(getActiveContext(), output)
  return output as TracePropagationData
}

const disposeTelemetry = async (): Promise<void> => {
  await provider.shutdown()
}

export {
  setUpTelemetry,
  getTracer,
  getActiveContext,
  disposeTelemetry,
  getActiveTracePropagationData,
}
export type { TelemetryConfig, TracePropagationData }
