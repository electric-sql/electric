import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { Agent } from 'undici'
import {
  createEntityRegistry,
  createRuntimeHandler,
  getCronStreamPathFromSpec,
  parseCronStreamPath,
  resolveCronScheduleSpec,
} from '@electric-ax/agents-runtime'
import { eq } from 'drizzle-orm'
import {
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from '@opentelemetry/api'
import { sendJsonError } from './electric-agents-http.js'
import { PostgresRegistry } from './electric-agents-registry.js'
import { WakeRegistry } from './wake-registry.js'
import { createDb, runMigrations } from './db/index.js'
import {
  consumerCallbacks,
  subscriptionWebhooks,
  wakeRegistrations,
} from './db/schema.js'
import { SchemaValidator } from './electric-agents-schema-validator.js'
import { ElectricAgentsManager } from './electric-agents-manager.js'
import { ElectricAgentsRoutes } from './electric-agents-routes.js'
import { ElectricAgentsEntityTypeRoutes } from './electric-agents-entity-type-routes.js'
import { ProjectRoutes } from './project-routes.js'
import { Scheduler, isPermanentElectricAgentsError } from './scheduler.js'
import { StreamClient } from './stream-client.js'
import { serverLog } from './log.js'
import { ATTR, extractTraceContext, tracer } from './tracing.js'
import { EntityBridgeManager } from './entity-bridge-manager.js'
import { TagStreamOutboxDrainer } from './tag-stream-outbox-drainer.js'
import { rewriteLoopbackWebhookUrl } from './webhook-url.js'
import {
  applyElectricUrlQueryParams,
  electricUrlWithPath,
} from './electric-url.js'
import type { WakeRegistration } from './wake-registry.js'
import type { DrizzleDB, PgClient } from './db/index.js'
import type { CronTickPayload, DelayedSendPayload } from './scheduler.js'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { DurableStreamTestServer } from '@durable-streams/server'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type {
  AgentModel,
  EntityRegistry,
  RuntimeHandler,
} from '@electric-ax/agents-runtime'

function isPrematureCloseError(err: unknown): boolean {
  return (
    err instanceof Error &&
    ((`code` in err && err.code === `ERR_STREAM_PREMATURE_CLOSE`) ||
      (`code` in err && err.code === `ERR_STREAM_UNABLE_TO_PIPE`) ||
      err.message === `Premature close` ||
      err.message === `Cannot pipe to a closed or destroyed stream`)
  )
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const AGENT_UI_DIST_DIR = path.resolve(
  MODULE_DIR,
  `../../agents-server-ui/dist`
)
const MOCK_AGENT_HANDLER_PATH = `/_electric/mock-agent-handler`

function contentTypeForStaticFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case `.html`:
      return `text/html; charset=utf-8`
    case `.js`:
      return `text/javascript; charset=utf-8`
    case `.css`:
      return `text/css; charset=utf-8`
    case `.json`:
      return `application/json; charset=utf-8`
    case `.svg`:
      return `image/svg+xml`
    case `.png`:
      return `image/png`
    case `.jpg`:
    case `.jpeg`:
      return `image/jpeg`
    case `.ico`:
      return `image/x-icon`
    case `.map`:
      return `application/json; charset=utf-8`
    default:
      return `application/octet-stream`
  }
}

export interface ElectricAgentsServerOptions {
  baseUrl?: string
  durableStreamsUrl?: string
  durableStreamsServer?: DurableStreamTestServer
  port: number
  host?: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  postgresUrl: string
  electricUrl?: string
  electricSecret?: string
}

interface MockAgentBootstrap {
  handler: RuntimeHandler[`onEnter`]
  runtime: RuntimeHandler
  registry: EntityRegistry
}

const MOCK_CHAT_MODEL: AgentModel = {
  id: `mock-chat`,
  name: `Mock Chat`,
  api: `anthropic-messages`,
  provider: `anthropic`,
  baseUrl: `http://mock`,
  reasoning: false,
  input: [`text`],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4_096,
}

function createMockAgentBootstrap(options: {
  agentServerUrl: string
  workingDirectory?: string
  streamFn: StreamFn
}): MockAgentBootstrap {
  const registry = createEntityRegistry()

  registry.define(`chat`, {
    description: `Mock chat entity for conformance and end-to-end tests.`,
    handler: async (ctx) => {
      ctx.useAgent({
        systemPrompt: `You are a concise test assistant.`,
        model: MOCK_CHAT_MODEL,
        tools: [],
        streamFn: options.streamFn,
      })
      await ctx.agent.run()
    },
  })

  const runtime = createRuntimeHandler({
    baseUrl: options.agentServerUrl,
    serveEndpoint: `${options.agentServerUrl}${MOCK_AGENT_HANDLER_PATH}`,
    registry,
    subscriptionPathForType: (name) => `/${name}/*/main`,
    idleTimeout: 5_000,
  })

  return {
    handler: runtime.onEnter,
    runtime,
    registry,
  }
}

export class ElectricAgentsServer {
  private server: Server | null = null
  private electricAgentsManager: ElectricAgentsManager | null = null
  private electricAgentsRoutes: ElectricAgentsRoutes | null = null
  private electricAgentsEntityTypeRoutes: ElectricAgentsEntityTypeRoutes | null =
    null
  private projectRoutes: ProjectRoutes | null = null
  private registry: PostgresRegistry | null = null
  private pgDb: DrizzleDB | null = null
  private pgClient: PgClient | null = null
  private scheduler: Scheduler | null = null
  private entityBridgeManager: EntityBridgeManager | null = null
  private tagStreamOutboxDrainer: TagStreamOutboxDrainer | null = null
  private mockAgentBootstrap: MockAgentBootstrap | null = null
  private _url: string | null = null
  private shuttingDown = false
  private streamsAgent: Agent | null = null

  streamClient: StreamClient
  readonly options: ElectricAgentsServerOptions

  constructor(options: ElectricAgentsServerOptions) {
    if (!options.durableStreamsUrl && !options.durableStreamsServer) {
      throw new Error(
        `Either durableStreamsUrl or durableStreamsServer is required`
      )
    }
    this.options = options
    this.streamClient = options.durableStreamsUrl
      ? new StreamClient(options.durableStreamsUrl)
      : null!
  }

  get url(): string {
    if (!this._url) {
      throw new Error(`Server not started`)
    }
    return this._url
  }

  private get publicUrl(): string {
    if (!this._url) {
      throw new Error(`Server not started`)
    }
    return this.options.baseUrl?.replace(/\/+$/, ``) ?? this._url
  }

  async start(): Promise<string> {
    if (this.server) {
      throw new Error(`Server already started`)
    }

    if (this.options.durableStreamsServer && !this.options.durableStreamsUrl) {
      serverLog.info(`[agent-server] starting durable streams server...`)
      const streamsUrl = await this.options.durableStreamsServer.start()
      serverLog.info(
        `[agent-server] durable streams server started at ${streamsUrl}`
      )
      ;(this.options as any).durableStreamsUrl = streamsUrl
      this.streamClient = new StreamClient(streamsUrl)
    }

    this.streamsAgent = new Agent({
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
      connections: 256,
      pipelining: 1,
      bodyTimeout: 0,
      headersTimeout: 0,
    })

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          serverLog.error(`[agent-server] Unhandled error:`, err)
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': `application/json` })
            res.end(JSON.stringify({ error: `Internal server error` }))
          }
        })
      })

      this.server.on(`error`, reject)

      const host = this.options.host ?? `127.0.0.1`
      this.server.listen(this.options.port, host, async () => {
        try {
          const addr = this.server!.address()
          if (typeof addr === `string`) {
            this._url = addr
          } else if (addr) {
            const resolvedHost = host === `0.0.0.0` ? `127.0.0.1` : host
            this._url = `http://${resolvedHost}:${addr.port}`
          } else {
            throw new Error(`Could not determine server address`)
          }

          // Initialize Postgres
          serverLog.info(`[agent-server] running migrations...`)
          await runMigrations(this.options.postgresUrl)
          serverLog.info(`[agent-server] migrations complete`)
          const { db, client } = createDb(this.options.postgresUrl)
          this.pgDb = db
          this.pgClient = client

          this.registry = new PostgresRegistry(db)

          const validator = new SchemaValidator()
          const wakeRegistry = new WakeRegistry(db)
          this.electricAgentsManager = new ElectricAgentsManager({
            registry: this.registry,
            streamClient: this.streamClient,
            validator,
            wakeRegistry,
          })
          this.entityBridgeManager = new EntityBridgeManager(
            this.registry,
            this.streamClient,
            this.options.electricUrl,
            this.options.electricSecret
          )
          this.electricAgentsManager.setEntityBridgeManager(
            this.entityBridgeManager
          )
          this.tagStreamOutboxDrainer = new TagStreamOutboxDrainer(
            this.registry,
            this.streamClient
          )
          this.scheduler = new Scheduler({
            pgClient: client,
            instanceId: randomUUID(),
            executors: {
              delayed_send: async (
                payload: DelayedSendPayload,
                taskId: number
              ) => {
                const producerId =
                  payload.producerId ?? `scheduler-task-${taskId}`
                try {
                  await this.electricAgentsManager!.send(
                    payload.entityUrl,
                    {
                      from: payload.from,
                      payload: payload.payload,
                      key: payload.key ?? `scheduled-task-${taskId}`,
                      type: payload.type,
                    },
                    {
                      producerId,
                    }
                  )

                  if (payload.manifest) {
                    await this.electricAgentsManager!.writeManifestEntry(
                      payload.manifest.ownerEntityUrl,
                      payload.manifest.key,
                      `update`,
                      omitUndefined({
                        ...payload.manifest.entry,
                        status: `sent`,
                        sentAt: new Date().toISOString(),
                        failedAt: undefined,
                        lastError: undefined,
                      }),
                      {
                        producerId: `manifest-status-${producerId}-sent`,
                      }
                    )
                  }
                } catch (err) {
                  if (payload.manifest && isPermanentElectricAgentsError(err)) {
                    await this.electricAgentsManager!.writeManifestEntry(
                      payload.manifest.ownerEntityUrl,
                      payload.manifest.key,
                      `update`,
                      omitUndefined({
                        ...payload.manifest.entry,
                        status: `failed`,
                        failedAt: new Date().toISOString(),
                        sentAt: undefined,
                        lastError:
                          err instanceof Error ? err.message : String(err),
                      }),
                      {
                        producerId: `manifest-status-${producerId}-failed`,
                      }
                    )
                  }
                  throw err
                }
              },
              cron_tick: async (
                payload: CronTickPayload,
                tickNumber: number
              ) => {
                const streamPath = payload.streamPath
                const encodedExpression = streamPath.split(`/`).at(-1)
                const spec = parseCronStreamPath(streamPath, {
                  fallback: `utc`,
                })
                const tickEvent = {
                  type: `cron_tick`,
                  key: `tick-${tickNumber}`,
                  value: {
                    expression: spec.expression,
                    timezone: spec.timezone,
                    firedAt: new Date().toISOString(),
                    tickNumber,
                  },
                  headers: {
                    operation: `insert`,
                    timestamp: new Date().toISOString(),
                  },
                }
                await this.streamClient.appendIdempotent(
                  streamPath,
                  new TextEncoder().encode(JSON.stringify(tickEvent)),
                  {
                    producerId: `scheduler-cron-${encodedExpression}-${tickNumber}`,
                  }
                )
                await this.electricAgentsManager!.evaluateWakes(
                  streamPath,
                  tickEvent
                )
              },
            },
          })
          this.electricAgentsManager.setScheduler(this.scheduler)

          serverLog.info(`[agent-server] rebuilding wake registry...`)
          await this.electricAgentsManager.rebuildWakeRegistry(
            this.options.electricUrl,
            this.options.electricSecret
          )
          serverLog.info(`[agent-server] rehydrating cron schedules...`)
          await this.rehydrateCronSchedules()
          serverLog.info(`[agent-server] starting entity bridge manager...`)
          await this.entityBridgeManager.start()
          serverLog.info(`[agent-server] starting tag stream outbox drainer...`)
          this.tagStreamOutboxDrainer.start()
          serverLog.info(`[agent-server] starting scheduler...`)
          await this.scheduler.start()
          serverLog.info(`[agent-server] scheduler started`)

          this.electricAgentsRoutes = new ElectricAgentsRoutes(
            this.electricAgentsManager
          )
          this.electricAgentsEntityTypeRoutes =
            new ElectricAgentsEntityTypeRoutes(this.electricAgentsManager)
          this.projectRoutes = new ProjectRoutes()

          if (this.options.mockStreamFn) {
            this.mockAgentBootstrap = createMockAgentBootstrap({
              agentServerUrl: this.publicUrl,
              workingDirectory: this.options.workingDirectory,
              streamFn: this.options.mockStreamFn,
            })
            await this.mockAgentBootstrap.runtime.registerTypes()
            serverLog.info(
              `[agent-server] mock chat agent registered at ${MOCK_AGENT_HANDLER_PATH}`
            )
          }

          resolve(this._url)
        } catch (err) {
          await this.stop().catch(() => {})
          reject(err)
        }
      })
    })
  }

  async stop(): Promise<void> {
    this.shuttingDown = true

    if (this.server) {
      const server = this.server
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections()
        server.closeAllConnections()
      })
      this.server = null
      this._url = null
    }

    if (this.options.durableStreamsServer) {
      await this.options.durableStreamsServer.stop()
    }

    if (this.mockAgentBootstrap) {
      this.mockAgentBootstrap.runtime.abortWakes()
      await Promise.race([
        this.mockAgentBootstrap.runtime.drainWakes().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      this.mockAgentBootstrap = null
    }

    if (this.electricAgentsManager) {
      if (this.scheduler) {
        await this.scheduler.stop()
        this.scheduler = null
      }
      await this.tagStreamOutboxDrainer?.stop()
      this.tagStreamOutboxDrainer = null
      await this.entityBridgeManager?.stop()
      this.entityBridgeManager = null
      await this.electricAgentsManager.shutdown()
      this.electricAgentsManager = null
      this.electricAgentsRoutes = null
      this.electricAgentsEntityTypeRoutes = null
      this.projectRoutes = null
      this.registry = null
    }

    if (this.pgClient) {
      await this.pgClient.end()
      this.pgClient = null
      this.pgDb = null
    }

    if (this.streamsAgent) {
      await this.streamsAgent.close().catch(() => {})
      this.streamsAgent = null
    }

    this.shuttingDown = false
  }

  private async rehydrateCronSchedules(): Promise<void> {
    if (!this.pgDb || !this.electricAgentsManager || !this.scheduler) return

    const rows = await this.pgDb
      .select({ sourceUrl: wakeRegistrations.sourceUrl })
      .from(wakeRegistrations)
    const cronSpecs = new Map<
      string,
      { expression: string; timezone: string }
    >()

    for (const row of rows) {
      if (!row.sourceUrl.startsWith(`/_cron/`)) continue
      try {
        const spec = parseCronStreamPath(row.sourceUrl, { fallback: `utc` })
        cronSpecs.set(JSON.stringify(spec), spec)
      } catch (err) {
        serverLog.warn(`[agent-server] invalid cron wake registration:`, err)
      }
    }

    for (const spec of cronSpecs.values()) {
      try {
        await this.electricAgentsManager.getOrCreateCronStream(
          spec.expression,
          spec.timezone
        )
      } catch (err) {
        serverLog.warn(`[agent-server] cron rehydration failed:`, err)
      }
    }

    const { entities } = await this.electricAgentsManager.registry.listEntities(
      {
        limit: 10_000,
      }
    )
    await this.electricAgentsManager.registry.clearEntityManifestSources()

    for (const entity of entities) {
      try {
        const events = await this.streamClient.readJson<
          Record<string, unknown>
        >(entity.streams.main)
        const manifestEvents = new Map<string, Record<string, unknown>>()

        for (const event of events) {
          if (event.type !== `manifest` || typeof event.key !== `string`) {
            continue
          }
          manifestEvents.set(event.key, event)
        }

        for (const [manifestKey, event] of manifestEvents) {
          const headers = event.headers as Record<string, unknown> | undefined
          const operation = headers?.operation as string | undefined
          const value = event.value as Record<string, unknown> | undefined
          await this.applyManifestEntitySource(
            entity.url,
            manifestKey,
            operation,
            value
          )
          await this.applyManifestFutureSendSchedule(
            entity.url,
            manifestKey,
            operation,
            value
          )
        }
      } catch (err) {
        serverLog.warn(
          `[agent-server] manifest future_send rehydration failed for ${entity.url}:`,
          err
        )
      }
    }
  }

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const method = req.method?.toUpperCase() ?? `GET`
    const requestUrl = new URL(req.url ?? `/`, `http://localhost`)
    const parentCtx = extractTraceContext(
      req.headers as Record<string, string | Array<string> | undefined>
    )
    const span = tracer.startSpan(
      `HTTP ${method}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          [ATTR.HTTP_METHOD]: method,
          [ATTR.HTTP_ROUTE]: requestUrl.pathname,
        },
      },
      parentCtx
    )
    return await otelContext.with(trace.setSpan(parentCtx, span), async () => {
      try {
        await this.handleRequestInner(req, res)
        span.setAttribute(ATTR.HTTP_STATUS, res.statusCode)
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

  private async handleRequestInner(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? `/`, `http://localhost`)
    const path = url.pathname

    if (
      this.shuttingDown &&
      path.startsWith(`/_electric/subscription-webhook/`)
    ) {
      sendJsonError(res, 503, `SERVER_STOPPING`, `Server is shutting down`)
      return
    }
    const method = req.method?.toUpperCase()

    res.setHeader(`access-control-allow-origin`, `*`)
    res.setHeader(
      `access-control-allow-methods`,
      `GET, POST, PUT, PATCH, DELETE, OPTIONS`
    )
    res.setHeader(
      `access-control-allow-headers`,
      `content-type, authorization, ngrok-skip-browser-warning`
    )
    if (method === `OPTIONS`) {
      res.writeHead(204)
      res.end()
      return
    }

    if (path === `/` && [`GET`, `HEAD`].includes(method ?? ``)) {
      res.writeHead(302, { location: `/__agent_ui/` })
      res.end()
      return
    }

    if (path === `/__agent_ui` && [`GET`, `HEAD`].includes(method ?? ``)) {
      res.writeHead(302, { location: `/__agent_ui/` })
      res.end()
      return
    }

    if (
      path.startsWith(`/__agent_ui/`) &&
      [`GET`, `HEAD`].includes(method ?? ``)
    ) {
      await this.handleAgentUiRequest(path, res, method === `HEAD`)
      return
    }

    if (path === `/_electric/health` && method === `GET`) {
      res.writeHead(200, { 'content-type': `application/json` })
      res.end(JSON.stringify({ status: `ok` }))
      return
    }

    if (
      path === MOCK_AGENT_HANDLER_PATH &&
      method === `POST` &&
      this.mockAgentBootstrap
    ) {
      await this.mockAgentBootstrap.handler(req, res)
      return
    }

    if (
      path.startsWith(`/_electric/webhook-forward/`) &&
      method === `POST` &&
      this.electricAgentsManager
    ) {
      await this.handleWebhookForward(path, req, res)
      return
    }

    if (
      path.startsWith(`/_electric/callback-forward/`) &&
      method === `POST` &&
      this.electricAgentsManager
    ) {
      await this.handleCallbackForward(path, req, res)
      return
    }

    // Electric proxy: /_electric/electric/* (only when electricUrl is configured)
    if (
      this.options.electricUrl &&
      path.startsWith(`/_electric/electric/`) &&
      method === `GET`
    ) {
      await this.handleElectricProxy(req, res)
      return
    }

    if (
      this.projectRoutes &&
      method &&
      (path.startsWith(`/_electric/projects`) ||
        path === `/_electric/validate-path`)
    ) {
      const handled = await this.projectRoutes.handleRequest(
        method,
        path,
        req,
        res
      )
      if (handled) return
    }

    if (
      this.electricAgentsEntityTypeRoutes &&
      method &&
      path.startsWith(`/_electric/entity-types`)
    ) {
      const handled = await this.electricAgentsEntityTypeRoutes.handleRequest(
        method,
        path,
        req,
        res
      )
      if (handled) return
    }

    if (
      path === `/_electric/wake` &&
      method === `POST` &&
      this.electricAgentsManager
    ) {
      const body = await readBody(req)
      try {
        const opts = JSON.parse(new TextDecoder().decode(body)) as {
          subscriberUrl: string
          sourceUrl: string
          condition:
            | `runFinished`
            | {
                on: `change`
                collections?: Array<string>
                ops?: Array<`insert` | `update` | `delete`>
              }
          debounceMs?: number
          timeoutMs?: number
          includeResponse?: boolean
          manifestKey?: string
        }
        await this.electricAgentsManager.registerWake(opts)
        res.writeHead(204)
        res.end()
      } catch {
        res.writeHead(400, { 'content-type': `application/json` })
        res.end(JSON.stringify({ error: `invalid wake registration body` }))
      }
      return
    }

    if (this.electricAgentsRoutes && method) {
      const handled = await this.electricAgentsRoutes.handleRequest(
        method,
        path,
        req,
        res
      )
      if (handled) return
    }

    if (
      method &&
      [`PUT`, `DELETE`].includes(method) &&
      url.searchParams.has(`subscription`)
    ) {
      const handled = await this.handleSubscriptionProxy(url, req, res)
      if (handled) return
    }

    if (method === `POST`) {
      const handled = await this.handleStreamAppend(path, req, res)
      if (handled) return
    }

    await this.proxyRequest(req, res)
  }

  private async handleStreamAppend(
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (!this.electricAgentsManager) return false

    const entity =
      await this.electricAgentsManager.registry.getEntityByStream(path)
    const isSharedState = path.startsWith(`/_electric/shared-state/`)
    if (!entity && !isSharedState) {
      return false
    }

    const body = await readBody(req)
    let event: Record<string, unknown> | Array<Record<string, unknown>> | null =
      null
    try {
      event = JSON.parse(new TextDecoder().decode(body)) as
        | Record<string, unknown>
        | Array<Record<string, unknown>>
    } catch {
      event = null
    }

    if (entity) {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, ``) ?? ``
      if (token !== entity.write_token) {
        sendJsonError(res, 401, `UNAUTHORIZED`, `Invalid write token`)
        return true
      }
      if (this.electricAgentsManager.isForkWriteLockedEntity(entity.url)) {
        sendJsonError(
          res,
          409,
          `FORK_IN_PROGRESS`,
          `Entity subtree is being forked`
        )
        return true
      }
      if (entity.status === `stopped`) {
        sendJsonError(res, 409, `NOT_RUNNING`, `Entity is stopped`)
        return true
      }

      if (event) {
        const events = Array.isArray(event) ? event : [event]
        for (const eventItem of events) {
          const validationError =
            await this.electricAgentsManager.validateWriteEvent(
              entity,
              eventItem
            )
          if (validationError) {
            sendJsonError(
              res,
              validationError.status,
              validationError.code,
              validationError.message
            )
            return true
          }
        }
      }
    } else if (
      isSharedState &&
      this.electricAgentsManager.isForkWriteLockedStream(path)
    ) {
      sendJsonError(
        res,
        409,
        `FORK_IN_PROGRESS`,
        `Entity subtree is being forked`
      )
      return true
    }

    const upstream = await this.forwardRequest(req, body)

    const responseBytes = upstream.body
      ? new Uint8Array(await upstream.arrayBuffer())
      : new Uint8Array()
    this.writeResponse(res, upstream, responseBytes)

    if (!upstream.ok || !event) {
      return true
    }

    if (entity) {
      void this.evaluateWakePayload(entity.url, event).catch((err) =>
        serverLog.warn(`[agent-server] wake evaluation failed:`, err)
      )
      this.checkRunFinished(entity.url, event)
    } else if (isSharedState) {
      void this.evaluateWakePayload(path, event).catch((err) =>
        serverLog.warn(`[agent-server] wake evaluation failed:`, err)
      )
    }

    if (entity) {
      void this.syncManifestWakes(entity.url, event).catch((err) =>
        serverLog.warn(`[agent-server] manifest wake sync failed:`, err)
      )
      void this.syncManifestEntitySources(entity.url, event).catch((err) =>
        serverLog.warn(`[agent-server] manifest source sync failed:`, err)
      )
      void this.syncManifestSchedules(entity.url, event).catch((err) =>
        serverLog.warn(`[agent-server] manifest schedule sync failed:`, err)
      )
    }

    return true
  }

  private extractManifestSourceUrl(
    manifest: Record<string, unknown>
  ): string | undefined {
    const kind = manifest.kind as string | undefined
    if (kind === `child` || kind === `observe`) {
      return manifest.entity_url as string | undefined
    }
    if (kind === `source`) {
      const sourceType = manifest.sourceType as string | undefined
      const config = manifest.config as Record<string, unknown> | undefined
      if (sourceType === `entity`) {
        return config?.entityUrl as string | undefined
      }
      if (sourceType === `cron` && config) {
        const expression = config.expression as string | undefined
        if (expression) {
          const spec = resolveCronScheduleSpec(
            expression,
            typeof config.timezone === `string` ? config.timezone : undefined,
            { fallback: `utc` }
          )
          return getCronStreamPathFromSpec(spec)
        }
      }
      if (sourceType === `entities`) {
        return typeof manifest.sourceRef === `string`
          ? `/_entities/${manifest.sourceRef}`
          : undefined
      }
      if (sourceType === `db`) {
        return typeof manifest.sourceRef === `string`
          ? `/_electric/shared-state/${manifest.sourceRef}`
          : undefined
      }
      return undefined
    }
    if (kind === `shared-state`) {
      const id = manifest.id as string | undefined
      return id ? `/_electric/shared-state/${id}` : undefined
    }
    if (kind === `schedule`) {
      const scheduleType = manifest.scheduleType as string | undefined
      if (scheduleType === `cron`) {
        const expression = manifest.expression as string | undefined
        if (expression) {
          const spec = resolveCronScheduleSpec(
            expression,
            typeof manifest.timezone === `string`
              ? manifest.timezone
              : undefined,
            { fallback: `utc` }
          )
          return getCronStreamPathFromSpec(spec)
        }
      }
      return undefined
    }
    return undefined
  }

  private extractManifestCronSpec(
    manifest: Record<string, unknown> | undefined
  ): { expression: string; timezone: string } | undefined {
    if (!manifest) return undefined

    if (manifest.kind === `source` && manifest.sourceType === `cron`) {
      const config = manifest.config as Record<string, unknown> | undefined
      if (config && typeof config.expression === `string`) {
        return resolveCronScheduleSpec(
          config.expression,
          typeof config.timezone === `string` ? config.timezone : undefined,
          { fallback: `utc` }
        )
      }
      return undefined
    }

    if (
      manifest.kind === `schedule` &&
      manifest.scheduleType === `cron` &&
      typeof manifest.expression === `string`
    ) {
      return resolveCronScheduleSpec(
        manifest.expression,
        typeof manifest.timezone === `string` ? manifest.timezone : undefined,
        { fallback: `utc` }
      )
    }

    return undefined
  }

  private buildManifestWakeRegistration(
    subscriberUrl: string,
    manifest: Record<string, unknown> | undefined
  ): WakeRegistration | null {
    if (!manifest) return null

    const sourceUrl = this.extractManifestSourceUrl(manifest)
    if (!sourceUrl) return null

    const wake =
      manifest.kind === `schedule` && manifest.scheduleType === `cron`
        ? (manifest.wake ?? { on: `change` })
        : manifest.wake
    if (wake === `runFinished`) {
      return {
        subscriberUrl,
        sourceUrl,
        condition: `runFinished`,
        oneShot: false,
      }
    }

    if (!wake || typeof wake !== `object`) return null

    const wakeConfig = wake as Record<string, unknown>
    if (wakeConfig.on !== `change`) return null

    const collections = Array.isArray(wakeConfig.collections)
      ? wakeConfig.collections.filter((c): c is string => typeof c === `string`)
      : undefined
    const ops = Array.isArray(wakeConfig.ops)
      ? wakeConfig.ops.filter(
          (op): op is `insert` | `update` | `delete` =>
            op === `insert` || op === `update` || op === `delete`
        )
      : undefined

    return {
      subscriberUrl,
      sourceUrl,
      condition: {
        on: `change`,
        ...(collections ? { collections } : {}),
        ...(ops ? { ops } : {}),
      },
      debounceMs:
        typeof wakeConfig.debounceMs === `number`
          ? wakeConfig.debounceMs
          : undefined,
      timeoutMs:
        typeof wakeConfig.timeoutMs === `number`
          ? wakeConfig.timeoutMs
          : undefined,
      oneShot: false,
    }
  }

  private async syncManifestWakes(
    subscriberUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.electricAgentsManager) return

    const events = Array.isArray(event) ? event : [event]
    for (const item of events) {
      const eventType = item.type as string | undefined
      if (eventType !== `manifest`) continue

      const headers = item.headers as Record<string, unknown> | undefined
      const operation = headers?.operation as string | undefined
      const manifestKey = item.key as string | undefined
      const value = item.value as Record<string, unknown> | undefined

      if (!manifestKey) continue

      if (operation === `delete`) {
        await this.electricAgentsManager.wakeRegistry.unregisterByManifestKey(
          subscriberUrl,
          manifestKey
        )
        continue
      }

      await this.electricAgentsManager.wakeRegistry.unregisterByManifestKey(
        subscriberUrl,
        manifestKey
      )

      if (value) {
        const reg = this.buildManifestWakeRegistration(subscriberUrl, value)
        if (reg) {
          reg.manifestKey = manifestKey
          await this.electricAgentsManager.wakeRegistry.register(reg)
        }

        const cronSpec = this.extractManifestCronSpec(value)
        if (cronSpec) {
          void this.electricAgentsManager
            .getOrCreateCronStream(cronSpec.expression, cronSpec.timezone)
            .catch((err) =>
              serverLog.warn(`[agent-server] cron schedule failed:`, err)
            )
        }
      }
    }
  }

  private async syncManifestEntitySources(
    ownerEntityUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.electricAgentsManager) return

    const events = Array.isArray(event) ? event : [event]
    for (const item of events) {
      if (item.type !== `manifest`) continue

      const manifestKey = item.key as string | undefined
      const headers = item.headers as Record<string, unknown> | undefined
      const operation = headers?.operation as string | undefined
      const value = item.value as Record<string, unknown> | undefined

      if (!manifestKey) continue
      await this.applyManifestEntitySource(
        ownerEntityUrl,
        manifestKey,
        operation,
        value
      )
    }
  }

  private async syncManifestSchedules(
    ownerEntityUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.scheduler) return

    const events = Array.isArray(event) ? event : [event]
    for (const item of events) {
      if (item.type !== `manifest`) continue

      const manifestKey = item.key as string | undefined
      const headers = item.headers as Record<string, unknown> | undefined
      const operation = headers?.operation as string | undefined
      const value = item.value as Record<string, unknown> | undefined

      if (!manifestKey) continue
      await this.applyManifestFutureSendSchedule(
        ownerEntityUrl,
        manifestKey,
        operation,
        value
      )
    }
  }

  private async applyManifestFutureSendSchedule(
    ownerEntityUrl: string,
    manifestKey: string,
    operation: string | undefined,
    value: Record<string, unknown> | undefined
  ): Promise<void> {
    if (!this.scheduler) return

    if (operation === `delete`) {
      await this.scheduler.cancelManifestDelayedSend(
        ownerEntityUrl,
        manifestKey
      )
      return
    }

    if (
      !value ||
      value.kind !== `schedule` ||
      value.scheduleType !== `future_send`
    ) {
      await this.scheduler.cancelManifestDelayedSend(
        ownerEntityUrl,
        manifestKey
      )
      return
    }

    if (value.status !== undefined && value.status !== `pending`) {
      await this.scheduler.cancelManifestDelayedSend(
        ownerEntityUrl,
        manifestKey
      )
      return
    }

    const fireAtRaw = value.fireAt
    const producerId = value.producerId
    const targetUrl = value.targetUrl
    if (
      typeof fireAtRaw !== `string` ||
      typeof producerId !== `string` ||
      typeof targetUrl !== `string`
    ) {
      serverLog.warn(
        `[agent-server] invalid future_send manifest entry for ${ownerEntityUrl}/${manifestKey}`
      )
      return
    }

    const fireAt = new Date(fireAtRaw)
    if (Number.isNaN(fireAt.getTime())) {
      serverLog.warn(
        `[agent-server] invalid future_send fireAt for ${ownerEntityUrl}/${manifestKey}: ${fireAtRaw}`
      )
      return
    }

    await this.scheduler.syncManifestDelayedSend(
      ownerEntityUrl,
      manifestKey,
      {
        entityUrl: targetUrl,
        from: typeof value.from === `string` ? value.from : ownerEntityUrl,
        payload: value.payload,
        key: `scheduled-${producerId}`,
        type:
          typeof value.messageType === `string` ? value.messageType : undefined,
        producerId,
        manifest: {
          ownerEntityUrl,
          key: manifestKey,
          entry: omitUndefined({
            ...value,
            key: manifestKey,
            kind: `schedule`,
            scheduleType: `future_send`,
            targetUrl,
            fireAt: fireAt.toISOString(),
            producerId,
            status: `pending`,
          }),
        },
      },
      fireAt
    )
  }

  private async applyManifestEntitySource(
    ownerEntityUrl: string,
    manifestKey: string,
    operation: string | undefined,
    value: Record<string, unknown> | undefined
  ): Promise<void> {
    if (!this.electricAgentsManager) return

    const sourceRef =
      operation === `delete` ? undefined : this.extractEntitiesSourceRef(value)
    await this.electricAgentsManager.registry.replaceEntityManifestSource(
      ownerEntityUrl,
      manifestKey,
      sourceRef
    )
  }

  private extractEntitiesSourceRef(
    manifest: Record<string, unknown> | undefined
  ): string | undefined {
    if (
      manifest?.kind === `source` &&
      manifest.sourceType === `entities` &&
      typeof manifest.sourceRef === `string`
    ) {
      return manifest.sourceRef
    }
    return undefined
  }

  private checkRunFinished(
    sourceUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): void {
    if (!this.electricAgentsManager) return

    const events = Array.isArray(event) ? event : [event]
    for (const item of events) {
      if (item.type !== `run`) continue
      const value = item.value as Record<string, unknown> | undefined
      const headers = item.headers as Record<string, unknown> | undefined
      const status = value?.status as string | undefined
      const operation = headers?.operation as string | undefined
      if (
        operation === `update` &&
        (status === `completed` || status === `failed`)
      ) {
        void this.maybeMarkEntityIdleAfterRunFinished(sourceUrl)
        return
      }
    }
  }

  private async maybeMarkEntityIdleAfterRunFinished(
    entityUrl: string
  ): Promise<void> {
    const manager = this.electricAgentsManager
    if (!manager || this.shuttingDown) return

    if (this.pgDb) {
      const primaryStream = `${entityUrl}/main`
      const callbacks = await this.pgDb
        .select()
        .from(consumerCallbacks)
        .where(eq(consumerCallbacks.primaryStream, primaryStream))
        .limit(1)

      if (callbacks.length > 0) {
        return
      }
    }

    const activeManager = this.electricAgentsManager
    // This can change across the async DB read above during shutdown/restart.

    if (this.shuttingDown || activeManager !== manager) {
      return
    }

    await activeManager.registry.updateStatus(entityUrl, `idle`)
    await this.entityBridgeManager?.onEntityChanged(entityUrl)
  }

  private async evaluateWakePayload(
    sourceUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.electricAgentsManager) return

    if (Array.isArray(event)) {
      await Promise.all(
        event.map((item) =>
          this.electricAgentsManager!.evaluateWakes(sourceUrl, item)
        )
      )
      return
    }

    await this.electricAgentsManager.evaluateWakes(sourceUrl, event)
  }

  private async proxyRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const upstream = await this.forwardRequest(req)
    const streamPath = new URL(req.url ?? `/`, `http://localhost`).pathname
    const endTrackedRead =
      req.method?.toUpperCase() === `GET`
        ? await this.entityBridgeManager?.beginClientRead(streamPath)
        : null
    try {
      if (req.method?.toUpperCase() === `HEAD`) {
        await this.entityBridgeManager?.touchByStreamPath(streamPath)
      }
      await this.writeStreamingResponse(res, upstream)
    } catch (err) {
      if (isPrematureCloseError(err)) {
        return
      }
      throw err
    } finally {
      await endTrackedRead?.()
    }
  }

  private async handleAgentUiRequest(
    requestPath: string,
    res: ServerResponse,
    headOnly: boolean
  ): Promise<void> {
    const relativePath = decodeURIComponent(
      requestPath.slice(`/__agent_ui/`.length)
    )
    const requestedFile =
      relativePath.length === 0 ? `index.html` : relativePath
    const filePath = this.resolveAgentUiPath(requestedFile)
    const fallbackToIndex =
      path.extname(requestedFile) === `` || requestedFile.endsWith(`/`)
    const resolvedFile = await this.pickAgentUiFile(filePath, fallbackToIndex)

    if (!resolvedFile) {
      sendJsonError(
        res,
        404,
        `AGENT_UI_NOT_FOUND`,
        `Agent UI build artifacts are missing`
      )
      return
    }

    const body = headOnly ? undefined : await readFile(resolvedFile)
    res.writeHead(200, {
      'content-type': contentTypeForStaticFile(resolvedFile),
      ...(resolvedFile.includes(`${path.sep}assets${path.sep}`)
        ? { 'cache-control': `public, max-age=31536000, immutable` }
        : { 'cache-control': `no-cache` }),
    })
    res.end(body)
  }

  private resolveAgentUiPath(relativePath: string): string {
    const normalized = relativePath.replace(/^\/+/, ``)
    return path.resolve(AGENT_UI_DIST_DIR, normalized)
  }

  private async pickAgentUiFile(
    filePath: string,
    fallbackToIndex: boolean
  ): Promise<string | null> {
    if (this.isAgentUiPath(filePath) && (await this.fileExists(filePath))) {
      return filePath
    }

    if (!fallbackToIndex) {
      return null
    }

    const indexPath = path.join(AGENT_UI_DIST_DIR, `index.html`)
    if (!(await this.fileExists(indexPath))) {
      return null
    }
    return indexPath
  }

  private isAgentUiPath(filePath: string): boolean {
    return (
      filePath === AGENT_UI_DIST_DIR ||
      filePath.startsWith(`${AGENT_UI_DIST_DIR}${path.sep}`)
    )
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async handleSubscriptionProxy(
    url: URL,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> {
    if (!this._url) return false
    const publicUrl = this.publicUrl

    const subscriptionId = url.searchParams.get(`subscription`)
    if (!subscriptionId) return false

    let requestBody: Uint8Array | undefined
    let targetWebhookUrl: string | null = null

    if (req.method?.toUpperCase() === `PUT`) {
      requestBody = await readBody(req)
      if (requestBody.length > 0) {
        try {
          const payload = JSON.parse(
            new TextDecoder().decode(requestBody)
          ) as Record<string, unknown>
          if (typeof payload.webhook === `string`) {
            targetWebhookUrl =
              rewriteLoopbackWebhookUrl(payload.webhook) ?? null
            payload.webhook = `${publicUrl}/_electric/webhook-forward/${encodeURIComponent(subscriptionId)}`
            requestBody = new TextEncoder().encode(JSON.stringify(payload))
          }
        } catch {
          // Non-JSON subscription body; let upstream validate it.
        }
      }
    }

    const upstream = await this.forwardRequest(req, requestBody)
    const responseBytes = upstream.body
      ? new Uint8Array(await upstream.arrayBuffer())
      : new Uint8Array()
    this.writeResponse(res, upstream, responseBytes)

    if (!upstream.ok) {
      return true
    }

    if (req.method?.toUpperCase() === `DELETE`) {
      if (this.pgDb) {
        await this.pgDb
          .delete(subscriptionWebhooks)
          .where(eq(subscriptionWebhooks.subscriptionId, subscriptionId))
      }
    } else if (targetWebhookUrl && this.pgDb) {
      await this.pgDb
        .insert(subscriptionWebhooks)
        .values({ subscriptionId, webhookUrl: targetWebhookUrl })
        .onConflictDoUpdate({
          target: subscriptionWebhooks.subscriptionId,
          set: { webhookUrl: targetWebhookUrl },
        })
    }

    return true
  }

  private async handleWebhookForward(
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const rootSpan = trace.getActiveSpan()
    rootSpan?.updateName(`webhook-forward`)
    const subscriptionId = decodeURIComponent(
      path.slice(`/_electric/webhook-forward/`.length)
    )
    rootSpan?.setAttribute(
      `electric_agents.webhook.subscription_id`,
      subscriptionId
    )

    const lookupPromise: Promise<string | null> = this.pgDb
      ? tracer.startActiveSpan(`db.lookupSubscription`, async (span) => {
          try {
            const rows = await this.pgDb!.select()
              .from(subscriptionWebhooks)
              .where(eq(subscriptionWebhooks.subscriptionId, subscriptionId))
              .limit(1)
            return rows[0]?.webhookUrl ?? null
          } finally {
            span.end()
          }
        })
      : Promise.resolve(null)

    const [targetWebhookUrl, body] = await Promise.all([
      lookupPromise,
      readBody(req),
    ])

    if (!targetWebhookUrl) {
      sendJsonError(
        res,
        404,
        `SUBSCRIPTION_NOT_FOUND`,
        `Unknown webhook subscription`
      )
      return
    }

    let forwardBody = body
    let runningEntityUrl: string | null = null

    let payload: Record<string, unknown> | null = null
    try {
      payload = JSON.parse(new TextDecoder().decode(body)) as Record<
        string,
        unknown
      >
    } catch {
      // If payload isn't JSON, just forward it as-is.
    }

    if (payload) {
      const primaryStream =
        typeof payload.primary_stream === `string`
          ? payload.primary_stream
          : typeof payload.primaryStream === `string`
            ? payload.primaryStream
            : typeof payload.streamPath === `string`
              ? payload.streamPath
              : null
      const consumerId =
        typeof payload.consumerId === `string`
          ? payload.consumerId
          : typeof payload.consumer_id === `string`
            ? payload.consumer_id
            : null
      const callbackUrl =
        typeof payload.callback === `string` ? payload.callback : null
      const publicUrl = this.publicUrl
      const isInternalAgentHandlerTarget =
        targetWebhookUrl.startsWith(`${this._url}/_electric/agent-handler`) ||
        targetWebhookUrl.startsWith(`${publicUrl}/_electric/agent-handler`)

      if (primaryStream) {
        rootSpan?.setAttribute(ATTR.STREAM_PATH, primaryStream)

        const entityPromise = tracer.startActiveSpan(
          `db.getEntityByStream`,
          async (span) => {
            try {
              return await this.electricAgentsManager!.registry.getEntityByStream(
                primaryStream
              )
            } finally {
              span.end()
            }
          }
        )
        const enrichPromise = tracer.startActiveSpan(
          `electric_agents.enrichPayload`,
          async (span) => {
            try {
              return await this.electricAgentsManager!.enrichPayload(payload, {
                primary_stream: primaryStream,
              })
            } finally {
              span.end()
            }
          }
        )

        const upsertPromise =
          this.pgDb && consumerId && callbackUrl
            ? tracer
                .startActiveSpan(`db.upsertConsumerCallback`, async (span) => {
                  try {
                    await this.pgDb!.insert(consumerCallbacks)
                      .values({ consumerId, callbackUrl, primaryStream })
                      .onConflictDoUpdate({
                        target: consumerCallbacks.consumerId,
                        set: { callbackUrl, primaryStream },
                      })
                  } finally {
                    span.end()
                  }
                })
                .catch((err) => {
                  serverLog.warn(
                    `[webhook-forward] consumerCallbacks upsert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
                  )
                })
            : undefined

        const [entity, enriched] = await Promise.all([
          entityPromise,
          enrichPromise,
        ])

        if (upsertPromise) await upsertPromise

        if (
          entity &&
          this.electricAgentsManager!.isForkWorkLockedEntity(entity.url)
        ) {
          sendJsonError(
            res,
            409,
            `FORK_IN_PROGRESS`,
            `Entity subtree is being forked`
          )
          return
        }

        if (entity && entity.status !== `stopped`) {
          rootSpan?.setAttribute(ATTR.ENTITY_URL, entity.url)
          await tracer.startActiveSpan(
            `db.updateStatus.running`,
            async (span) => {
              try {
                await this.electricAgentsManager!.registry.updateStatus(
                  entity.url,
                  `running`
                )
              } finally {
                span.end()
              }
            }
          )
          runningEntityUrl = entity.url
        }

        if (consumerId && callbackUrl) {
          enriched.callback = `${publicUrl}/_electric/callback-forward/${encodeURIComponent(consumerId)}`
        }
        if (isInternalAgentHandlerTarget && entity) {
          enriched.writeToken = entity.write_token
        }
        forwardBody = new TextEncoder().encode(JSON.stringify(enriched))
      }
    }

    const headers = this.buildForwardHeaders(req)
    headers.set(`content-type`, `application/json`)
    headers.delete(`content-length`)

    let upstream: Response
    try {
      upstream = await tracer.startActiveSpan(
        `fetch.agent-handler`,
        async (span) => {
          span.setAttribute(`http.url`, targetWebhookUrl)
          try {
            return await fetch(targetWebhookUrl, {
              method: req.method,
              headers,
              body: Buffer.from(forwardBody),
            })
          } finally {
            span.end()
          }
        }
      )
    } catch (err) {
      if (runningEntityUrl && this.electricAgentsManager) {
        await this.electricAgentsManager.registry.updateStatus(
          runningEntityUrl,
          `idle`
        )
      }
      sendJsonError(
        res,
        502,
        `WEBHOOK_FORWARD_FAILED`,
        err instanceof Error ? err.message : String(err)
      )
      return
    }
    const responseBytes = upstream.body
      ? new Uint8Array(await upstream.arrayBuffer())
      : new Uint8Array()
    this.writeResponse(res, upstream, responseBytes)
  }

  private async handleCallbackForward(
    path: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const consumerId = decodeURIComponent(
      path.slice(`/_electric/callback-forward/`.length)
    )
    let target:
      | { callbackUrl: string; primaryStream: string | null }
      | undefined
    if (this.pgDb) {
      const rows = await this.pgDb
        .select()
        .from(consumerCallbacks)
        .where(eq(consumerCallbacks.consumerId, consumerId))
        .limit(1)
      if (rows[0]) {
        target = {
          callbackUrl: rows[0].callbackUrl,
          primaryStream: rows[0].primaryStream,
        }
      }
    }

    if (!target) {
      sendJsonError(
        res,
        404,
        `CALLBACK_NOT_FOUND`,
        `Unknown callback-forward consumer`
      )
      return
    }

    const body = await readBody(req)
    const requestBody = decodeJsonObject(body)
    const isClaimRequest =
      typeof requestBody?.wakeId === `string` ||
      typeof requestBody?.wake_id === `string`

    const headers = this.buildForwardHeaders(req)
    headers.delete(`content-length`)

    let upstream: Response
    try {
      upstream = await fetch(target.callbackUrl, {
        method: req.method,
        headers,
        body: Buffer.from(body),
      })
    } catch (err) {
      sendJsonError(
        res,
        502,
        `CALLBACK_FORWARD_FAILED`,
        err instanceof Error ? err.message : String(err)
      )
      return
    }

    let responseBytes: Uint8Array<ArrayBufferLike> = upstream.body
      ? new Uint8Array(await upstream.arrayBuffer())
      : new Uint8Array()

    if (isClaimRequest && upstream.ok && target.primaryStream) {
      const responseBody = decodeJsonObject(responseBytes)
      if (responseBody?.ok === true) {
        const entity =
          await this.electricAgentsManager!.registry.getEntityByStream(
            target.primaryStream
          )
        if (entity) {
          responseBody.writeToken = entity.write_token
          responseBytes = new TextEncoder().encode(JSON.stringify(responseBody))
        }
      }
    }

    try {
      if (upstream.ok && requestBody?.done === true && target.primaryStream) {
        serverLog.info(
          `[callback-forward] done received for stream=${target.primaryStream} consumer=${consumerId}`
        )
        const entity =
          await this.electricAgentsManager!.registry.getEntityByStream(
            target.primaryStream
          )
        if (entity) {
          await this.electricAgentsManager!.registry.updateStatus(
            entity.url,
            `idle`
          )
          serverLog.info(
            `[callback-forward] status updated to idle for ${entity.url}`
          )
          await this.entityBridgeManager?.onEntityChanged(entity.url)
        } else {
          serverLog.warn(
            `[callback-forward] done received but no entity found for stream=${target.primaryStream}`
          )
        }
      } else if (requestBody?.done === true) {
        serverLog.warn(
          `[callback-forward] done received but skipped: upstream.ok=${upstream.ok} primaryStream=${target.primaryStream ?? `null`} consumer=${consumerId}`
        )
      }
    } catch (err) {
      serverLog.error(
        `[callback-forward] error processing done for consumer=${consumerId}: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    this.writeResponse(res, upstream, responseBytes)
  }

  private async handleElectricProxy(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const electricUrl = this.options.electricUrl
    if (!electricUrl) {
      sendJsonError(
        res,
        500,
        `ELECTRIC_PROXY_FAILED`,
        `Electric URL not configured`
      )
      return
    }
    const incomingUrl = new URL(req.url ?? `/`, `http://localhost`)
    const target = this.buildElectricProxyTarget(
      incomingUrl,
      electricUrl,
      this.options.electricSecret
    )

    let upstream: Response
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers: this.buildForwardHeaders(req),
      })
    } catch (err) {
      sendJsonError(
        res,
        502,
        `ELECTRIC_PROXY_FAILED`,
        err instanceof Error ? err.message : String(err)
      )
      return
    }

    try {
      await this.writeStreamingResponse(res, upstream)
    } catch (err) {
      if (isPrematureCloseError(err)) {
        return
      }
      throw err
    }
  }

  private buildElectricProxyTarget(
    incomingUrl: URL,
    electricUrl: string,
    electricSecret?: string
  ): URL {
    const targetPath = incomingUrl.pathname.replace(`/_electric/electric`, ``)
    const target = electricUrlWithPath(electricUrl, targetPath)
    incomingUrl.searchParams.forEach((value, key) => {
      target.searchParams.append(key, value)
    })
    applyElectricUrlQueryParams(target, electricUrl)

    if (targetPath !== `/v1/shape`) {
      return target
    }

    if (electricSecret) {
      target.searchParams.set(`secret`, electricSecret)
    }

    const table = incomingUrl.searchParams.get(`table`)
    if (table === `entities`) {
      target.searchParams.set(
        `columns`,
        `"url","type","status","tags","spawn_args","parent","type_revision","inbox_schemas","state_schemas","created_at","updated_at"`
      )
    } else if (table === `entity_types`) {
      target.searchParams.set(
        `columns`,
        `"name","description","creation_schema","inbox_schemas","state_schemas","serve_endpoint","revision","created_at","updated_at"`
      )
    }

    return target
  }

  private async forwardRequest(
    req: IncomingMessage,
    body?: Uint8Array
  ): Promise<Response> {
    const upstreamUrl = new URL(req.url ?? `/`, this.options.durableStreamsUrl)
    const headers = this.buildForwardHeaders(req)

    let requestBody = body
    if (
      requestBody === undefined &&
      req.method &&
      ![`GET`, `HEAD`].includes(req.method.toUpperCase())
    ) {
      requestBody = await readBody(req)
    }

    const init: RequestInit & { duplex?: `half`; dispatcher?: Agent } = {
      method: req.method,
      headers,
    }
    if (requestBody !== undefined) {
      headers.delete(`content-length`)
      init.body = Buffer.from(requestBody)
      init.duplex = `half`
    }
    if (this.streamsAgent) {
      init.dispatcher = this.streamsAgent
    }

    return fetch(upstreamUrl, init as RequestInit)
  }

  private buildForwardHeaders(req: IncomingMessage): Headers {
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      if (key === `host`) continue
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item)
        }
      } else {
        headers.set(key, value)
      }
    }
    return headers
  }

  private writeResponse(
    res: ServerResponse,
    upstream: Response,
    body: Uint8Array
  ): void {
    const headers = this.responseHeaders(upstream)
    res.writeHead(upstream.status, headers)
    res.end(body)
  }

  private async writeStreamingResponse(
    res: ServerResponse,
    upstream: Response
  ): Promise<void> {
    const headers = this.responseHeaders(upstream)
    res.writeHead(upstream.status, headers)

    if (!upstream.body) {
      res.end()
      return
    }

    await pipeline(Readable.fromWeb(upstream.body as any), res)
  }

  private responseHeaders(upstream: Response): Record<string, string> {
    const headers: Record<string, string> = {}
    upstream.headers.forEach((value, key) => {
      if (
        key === `content-encoding` ||
        key === `content-length` ||
        key === `transfer-encoding` ||
        key === `connection` ||
        key.startsWith(`access-control-`)
      ) {
        return
      }
      headers[key] = value
    })
    // Ensure CORS headers survive on proxied responses (e.g. shape stream
    // reads that get forwarded to the durable-streams upstream). Cross-origin
    // browser clients need these on every response, not just the top-level
    // routes.
    headers[`access-control-allow-origin`] = `*`
    headers[`access-control-expose-headers`] = `*`
    return headers
  }
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on(`data`, (chunk: Buffer) => chunks.push(chunk))
    req.on(`end`, () => resolve(new Uint8Array(Buffer.concat(chunks))))
    req.on(`error`, reject)
  })
}

function decodeJsonObject(body: Uint8Array): Record<string, unknown> | null {
  if (body.length === 0) return null

  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown
    if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON; callers can fall back to raw bytes.
  }

  return null
}
