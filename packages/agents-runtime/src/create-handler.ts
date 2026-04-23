/**
 * Runtime router factory — creates a fetch-native request router for webhook
 * wake delivery plus a compatibility Node HTTP adapter.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import { processWebhookWake } from './process-wake'
import { getEntityType, listEntityTypes } from './define-entity'
import { DEFAULT_OUTPUT_SCHEMAS } from './default-output-schemas'
import { passthrough } from './entity-schema'
import { runtimeLog } from './log'
import type { EntityRegistry } from './define-entity'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  AgentTool,
  EntityStreamDBWithActions,
  ProcessWakeConfig,
  WebhookNotification,
} from './types'
import type { ChangeEvent } from '@durable-streams/state'

export interface RuntimeRouterConfig {
  /** Base URL of the durable streams server (e.g. http://localhost:4200) */
  baseUrl: string
  /**
   * Full webhook callback URL exposed by your app.
   * Used for Electric Agents `serve_endpoint` registration.
   */
  serveEndpoint?: string
  /**
   * Path matched by handleRequest(). Defaults to the pathname from serveEndpoint
   * (or handlerUrl), falling back to `/electric-agents`.
   */
  webhookPath?: string
  /**
   * Backward-compatible alias for serveEndpoint.
   * Prefer serveEndpoint for new code.
   */
  handlerUrl?: string
  /** Runtime-local entity registry for this handler */
  registry?: EntityRegistry
  /** Override the webhook subscription path used per entity type registration. */
  subscriptionPathForType?: (typeName: string) => string
  /** Idle timeout in ms before closing the wake (default: 20_000) */
  idleTimeout?: number
  /** Heartbeat interval in ms (default: 30_000) */
  heartbeatInterval?: number
  /** Optional tool factory invoked for each wake context before handler execution. */
  createElectricTools?: (context: {
    entityUrl: string
    entityType: string
    args: Readonly<Record<string, unknown>>
    db: EntityStreamDBWithActions
    events: Array<ChangeEvent>
    upsertCronSchedule: (opts: {
      id: string
      expression: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
    }) => Promise<{ txid: string }>
    upsertFutureSendSchedule: (opts: {
      id: string
      payload: unknown
      targetUrl?: string
      fireAt: string
      from?: string
      messageType?: string
    }) => Promise<{ txid: string }>
    deleteSchedule: (opts: { id: string }) => Promise<{ txid: string }>
  }) => Array<AgentTool> | Promise<Array<AgentTool>>
  /**
   * Optional observer for background wake failures. Return true to mark the
   * error as handled so it is not rethrown during runtime drain/cleanup.
   */
  onWakeError?: (error: Error) => boolean | void
  /** Max number of concurrent entity-type registrations (default: 8). */
  registrationConcurrency?: number
}

export interface RuntimeRouter {
  /**
   * Route a fetch Request. Returns null when the request is not for the runtime.
   */
  handleRequest: (request: Request) => Promise<Response | null>

  /**
   * Handle a webhook wake request directly, without route matching.
   */
  handleWebhookRequest: (request: Request) => Promise<Response>

  /**
   * Dispatch an already-parsed webhook wake notification.
   */
  dispatchWebhookWake: (notification: WebhookNotification) => void

  /**
   * Wait for all in-flight webhook wake handlers to settle.
   * Throws any wake errors instead of hiding them behind logs.
   */
  drainWakes: () => Promise<void>

  /**
   * Friendly alias for drainWakes(); intended for callers that care about
   * runtime quiescence rather than wake internals.
   */
  waitForSettled: () => Promise<void>

  /** Abort in-flight wakes so host shutdown can complete quickly. */
  abortWakes: () => void

  /** Runtime-local snapshot for tests and shutdown diagnostics. */
  debugState: () => RuntimeDebugState

  /** Names of all registered entity types */
  readonly typeNames: Array<string>

  /** Register all entity types with the durable streams server */
  registerTypes: () => Promise<void>
}

export interface RuntimeHandler extends RuntimeRouter {
  /**
   * Node HTTP compatibility adapter.
   * Prefer handleRequest(Request) in new integrations.
   */
  onEnter: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

export interface RuntimeDebugState {
  pendingWakeCount: number
  pendingWakeLabels: Array<string>
  wakeErrorCount: number
  typeNames: Array<string>
}

export type RuntimeHandlerConfig = RuntimeRouterConfig
export type RuntimeHandlerResult = RuntimeHandler

export function createRuntimeRouter(
  config: RuntimeRouterConfig
): RuntimeRouter {
  const normalized = normalizeConfig(config)
  const {
    baseUrl,
    serveEndpoint,
    webhookPath,
    registry,
    subscriptionPathForType,
    idleTimeout,
    heartbeatInterval,
    createElectricTools,
    registrationConcurrency,
  } = normalized

  const wakeConfig: ProcessWakeConfig = {
    baseUrl,
    registry,
    createElectricTools,
    idleTimeout,
    heartbeatInterval,
  }
  const getRegisteredType = (name: string) =>
    registry ? registry.get(name) : getEntityType(name)
  const getRegisteredTypes = () =>
    registry ? registry.list() : listEntityTypes()
  const debugRegistrationTiming =
    process.env.ELECTRIC_AGENTS_DEBUG_REGISTRATION_TIMING === `1`
  const pendingWakes = new Set<Promise<void>>()
  const pendingWakeLabels = new Map<Promise<void>, string>()
  const pendingWakeControllers = new Map<Promise<void>, AbortController>()
  const wakeErrors: Array<Error> = []
  const debugCleanup = process.env.ELECTRIC_AGENTS_DEBUG_CLEANUP === `1`

  const forEachWithConcurrency = async <T>(
    items: Array<T>,
    concurrency: number,
    handler: (item: T) => Promise<void>
  ): Promise<void> => {
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        if (index >= items.length) return
        await handler(items[index]!)
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency, items.length))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  }

  const dispatchWebhookWake = (notification: WebhookNotification): void => {
    const wakeLabel = notification.entity?.url ?? notification.streamPath
    const controller = new AbortController()
    const wake: Promise<void> = Promise.resolve(
      processWebhookWake(notification, {
        ...wakeConfig,
        shutdownSignal: controller.signal,
      })
    )
      .then(() => undefined)
      .catch((err: unknown) => {
        const wakeError = err instanceof Error ? err : new Error(String(err))
        const handled = config.onWakeError?.(wakeError) === true
        if (!handled) {
          wakeErrors.push(wakeError)
        }
        runtimeLog.error(
          `[agent-runtime]`,
          `Error processing wake for ${notification.entity?.url}:`,
          wakeError
        )
      })
      .finally(() => {
        pendingWakes.delete(wake)
        pendingWakeLabels.delete(wake)
        pendingWakeControllers.delete(wake)
      })
    pendingWakes.add(wake)
    pendingWakeLabels.set(wake, wakeLabel)
    pendingWakeControllers.set(wake, controller)
  }

  const abortWakes = (): void => {
    for (const controller of pendingWakeControllers.values()) {
      controller.abort()
    }
  }

  const drainWakes = async (): Promise<void> => {
    while (pendingWakes.size > 0) {
      if (debugCleanup) {
        console.error(
          `[agent-runtime][cleanup] waiting on ${pendingWakes.size} wake(s): ${[...pendingWakeLabels.values()].join(`, `)}`
        )
      }
      await Promise.all([...pendingWakes])
    }

    if (wakeErrors.length === 0) return

    const errors = [...wakeErrors]
    wakeErrors.length = 0
    if (errors.length === 1) {
      throw errors[0]!
    }
    throw new AggregateError(errors, `[agent-runtime] Background wake failed`)
  }

  const waitForSettled = async (): Promise<void> => {
    await drainWakes()
  }

  const debugState = (): RuntimeDebugState => ({
    pendingWakeCount: pendingWakes.size,
    pendingWakeLabels: [...pendingWakeLabels.values()],
    wakeErrorCount: wakeErrors.length,
    typeNames: getRegisteredTypes().map((entry) => entry.name),
  })

  const handleWebhookRequest = async (request: Request): Promise<Response> => {
    if (request.method !== `POST`) {
      return json({ error: `Method not allowed` }, 405)
    }

    let notification: WebhookNotification
    try {
      notification = (await request.json()) as WebhookNotification
    } catch (err) {
      return json(
        {
          error: `Invalid JSON`,
          details: err instanceof Error ? err.message : String(err),
        },
        400
      )
    }

    const typeName = notification.entity?.type
    const entityType = typeName ? getRegisteredType(typeName) : undefined
    if (!typeName || !entityType) {
      return json(
        { error: `Unknown entity type: ${typeName ?? `(none)`}` },
        503
      )
    }

    dispatchWebhookWake(notification)
    return json({ ok: true }, 200)
  }

  const handleRequest = async (request: Request): Promise<Response | null> => {
    const pathname = new URL(request.url).pathname
    if (pathname !== webhookPath) return null
    return handleWebhookRequest(request)
  }

  const stripSchemaKeyword = (
    jsonSchema: Record<string, unknown>
  ): Record<string, unknown> => {
    const { $schema: _schema, ...rest } = jsonSchema
    return rest
  }

  const JSON_SCHEMA_KEYWORDS = [
    `type`,
    `properties`,
    `items`,
    `enum`,
    `oneOf`,
    `anyOf`,
    `allOf`,
    `additionalProperties`,
  ] as const

  const toJsonSchema = (schema: unknown): Record<string, unknown> => {
    if (!schema || typeof schema !== `object` || Array.isArray(schema)) {
      return {}
    }

    const standardSchema = schema as {
      [`~standard`]?: {
        jsonSchema?: {
          input?: () => unknown
        }
      }
      toJSONSchema?: () => Record<string, unknown>
    }

    const standardJsonSchema =
      standardSchema[`~standard`]?.jsonSchema?.input?.()
    if (standardJsonSchema) {
      return stripSchemaKeyword(standardJsonSchema as Record<string, unknown>)
    }

    if (typeof standardSchema.toJSONSchema === `function`) {
      return stripSchemaKeyword(standardSchema.toJSONSchema())
    }

    if (`~standard` in standardSchema) {
      return {}
    }

    const jsonSchemaLike = schema as Record<string, unknown>
    if (JSON_SCHEMA_KEYWORDS.some((keyword) => keyword in jsonSchemaLike)) {
      return stripSchemaKeyword(jsonSchemaLike)
    }

    return zodToJsonSchema(schema as any, { target: `jsonSchema7` })
  }

  const registerTypes = async (): Promise<void> => {
    const types = getRegisteredTypes()
    const registered: Array<string> = []
    const failed: Array<string> = []
    const totalStart = performance.now()
    const effectiveConcurrency = Math.max(1, registrationConcurrency ?? 8)

    const mapSchemas = (
      schemas: Record<string, unknown>
    ): Record<string, Record<string, unknown>> =>
      Object.fromEntries(
        Object.entries(schemas).map(([k, v]) => [k, toJsonSchema(v)])
      )

    await forEachWithConcurrency(types, effectiveConcurrency, async (entry) => {
      const registrationStart = performance.now()
      const { name, definition } = entry

      const stateSchemas = definition.state
        ? Object.fromEntries(
            Object.entries(definition.state).map(([collectionName, def]) => [
              def.type ?? `state:${collectionName}`,
              toJsonSchema(def.schema ?? passthrough()),
            ])
          )
        : {}

      const body: Record<string, unknown> = {
        name,
        description: definition.description ?? `${name} entity`,
        ...(definition.creationSchema && {
          creation_schema: toJsonSchema(definition.creationSchema),
        }),
        ...(definition.inboxSchemas && {
          input_schemas: mapSchemas(definition.inboxSchemas),
        }),
        output_schemas: {
          ...DEFAULT_OUTPUT_SCHEMAS,
          ...stateSchemas,
          ...(definition.outputSchemas
            ? mapSchemas(definition.outputSchemas)
            : {}),
        },
      }

      if (serveEndpoint) {
        body.serve_endpoint = serveEndpoint
      }

      const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(body),
      })

      if (!typeRes.ok) {
        const err = await typeRes.text()
        runtimeLog.error(
          `[agent-runtime]`,
          `Failed to register type "${name}": ${err}`
        )
        failed.push(name)
        return
      }

      if (serveEndpoint) {
        const subPath = subscriptionPathForType
          ? subscriptionPathForType(name)
          : `/${name}/**`
        const subRes = await fetch(
          `${baseUrl}${subPath}?subscription=${name}-handler`,
          {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({
              webhook: serveEndpoint,
            }),
          }
        )

        if (!subRes.ok) {
          const err = await subRes.text()
          runtimeLog.error(
            `[agent-runtime]`,
            `Failed to create subscription for "${name}": ${err}`
          )
          failed.push(name)
          return
        }
      }

      registered.push(name)
      runtimeLog.info(`[agent-runtime]`, `Registered entity type: ${name}`)
      if (debugRegistrationTiming) {
        runtimeLog.info(
          `[agent-runtime]`,
          `Registration timing for "${name}": ${(performance.now() - registrationStart).toFixed(1)}ms`
        )
      }
    })

    if (failed.length > 0) {
      throw new Error(
        `[agent-runtime] ${registered.length}/${types.length} entity types registered (${failed.length} failed: ${failed.join(`, `)})`
      )
    }

    runtimeLog.info(
      `[agent-runtime]`,
      `${registered.length} entity types ready: ${registered.join(`, `)}`
    )
    if (debugRegistrationTiming) {
      runtimeLog.info(
        `[agent-runtime]`,
        `Total registration timing: ${(performance.now() - totalStart).toFixed(1)}ms`
      )
    }
  }

  return {
    handleRequest,
    handleWebhookRequest,
    dispatchWebhookWake,
    drainWakes,
    waitForSettled,
    abortWakes,
    debugState,
    get typeNames() {
      return getRegisteredTypes().map((entry) => entry.name)
    },
    registerTypes,
  }
}

export function createRuntimeHandler(
  config: RuntimeHandlerConfig
): RuntimeHandler {
  const router = createRuntimeRouter(config)

  const onEnter = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> => {
    let request: Request
    try {
      request = await toFetchRequest(req)
    } catch (err) {
      await sendNodeResponse(
        res,
        json(
          {
            error: `Request body read failed`,
            details: err instanceof Error ? err.message : String(err),
          },
          400
        )
      )
      return
    }

    const response = await router.handleWebhookRequest(request)
    await sendNodeResponse(res, response)
  }

  return {
    onEnter,
    handleRequest: router.handleRequest,
    handleWebhookRequest: router.handleWebhookRequest,
    dispatchWebhookWake: router.dispatchWebhookWake,
    drainWakes: router.drainWakes,
    waitForSettled: router.waitForSettled,
    abortWakes: router.abortWakes,
    debugState: router.debugState,
    get typeNames() {
      return router.typeNames
    },
    registerTypes: router.registerTypes,
  }
}

function normalizeConfig(config: RuntimeRouterConfig): {
  baseUrl: string
  serveEndpoint?: string
  webhookPath: string
  registry?: EntityRegistry
  subscriptionPathForType?: (typeName: string) => string
  idleTimeout?: number
  heartbeatInterval?: number
  createElectricTools?: RuntimeRouterConfig[`createElectricTools`]
  registrationConcurrency?: number
} {
  const serveEndpoint = config.serveEndpoint ?? config.handlerUrl
  const webhookPath =
    config.webhookPath ?? getPathname(serveEndpoint) ?? `/electric-agents`

  return {
    baseUrl: config.baseUrl,
    serveEndpoint,
    webhookPath,
    registry: config.registry,
    subscriptionPathForType: config.subscriptionPathForType,
    idleTimeout: config.idleTimeout,
    heartbeatInterval: config.heartbeatInterval,
    createElectricTools: config.createElectricTools,
    registrationConcurrency: config.registrationConcurrency,
  }
}

function getPathname(url: string | undefined): string | undefined {
  if (!url) return undefined
  return new URL(url).pathname
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': `application/json` },
  })
}

async function toFetchRequest(req: IncomingMessage): Promise<Request> {
  const body = await readBody(req)
  const host =
    typeof req.headers.host === `string` ? req.headers.host : `localhost`
  const url = new URL(req.url ?? `/`, `http://${host}`)
  const headers = new Headers()

  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
      continue
    }
    if (value === undefined) continue
    headers.set(name, value)
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: body.length > 0 ? Buffer.from(body) : undefined,
  })
}

async function sendNodeResponse(
  res: ServerResponse,
  response: Response
): Promise<void> {
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  res.writeHead(response.status, headers)

  const contentType = response.headers.get(`content-type`) ?? ``
  if (
    contentType.startsWith(`application/json`) ||
    contentType.startsWith(`text/`)
  ) {
    res.end(await response.text())
    return
  }

  const buffer = await response.arrayBuffer()
  res.end(Buffer.from(buffer))
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on(`data`, (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on(`end`, () => resolve(Buffer.concat(chunks)))
    req.on(`error`, reject)
  })
}
