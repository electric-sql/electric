import { context, trace, Span, SpanKind, Attributes } from '@opentelemetry/api'
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
}

const provider = new WebTracerProvider({
  resource: new Resource({
    [SEMRESATTRS_SERVICE_NAME]: `electric:client:typescript`,
    [SEMRESATTRS_SERVICE_VERSION]: LIB_VERSION,
  }),
})

let consoleExporterAdded = false
const addConsoleExporter = () => {
  if (consoleExporterAdded) return
  provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()))
  consoleExporterAdded = true
}

let otlpExporterAddded = false
const addOTLPExporter = () => {
  if (otlpExporterAddded) return
  provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()))
  otlpExporterAddded = true
}

const setUpTelemetry = ({
  logToConsole,
  exportToOTLP,
}: TelemetryConfig): void => {
  if (logToConsole) addConsoleExporter()
  if (exportToOTLP) addOTLPExporter()

  provider.register({
    contextManager: new StackContextManager(),
  })
}

const getTracer = (): Tracer => {
  return provider.getTracer(tracerName)
}

const startSpan = (
  name: string,
  {
    parentSpan,
    attributes,
    isClientRequest,
  }: {
    parentSpan?: Span
    attributes?: Attributes
    isClientRequest?: boolean
  } = {}
) => {
  return getTracer().startSpan(
    name,
    {
      kind: isClientRequest ? SpanKind.CLIENT : SpanKind.INTERNAL,
      attributes,
    },
    parentSpan && trace.setSpan(context.active(), parentSpan)
  )
}

const disposeTelemetry = async (): Promise<void> => {
  await provider.shutdown()
}

export { setUpTelemetry, startSpan, disposeTelemetry }
export type { TelemetryConfig }
