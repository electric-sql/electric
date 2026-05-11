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
import { sendJson, sendJsonError } from './electric-agents-http.js'
import { PostgresRegistry } from './electric-agents-registry.js'
import type {
  ExpiredActiveClaimRecoveryItem,
  StaleOutstandingWakeRecoveryItem,
} from './electric-agents-registry.js'
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
import { createRuntimeRegistry } from './runtime-registry.js'
import { Scheduler, isPermanentElectricAgentsError } from './scheduler.js'
import { StreamClient } from './stream-client.js'
import {
  DispatchWakeRouter,
  callbackForwardPathForConsumer,
} from './dispatch-wake-router.js'
import { serverLog } from './log.js'
import { ATTR, extractTraceContext, tracer } from './tracing.js'
import { EntityBridgeManager } from './entity-bridge-manager.js'
import { TagStreamOutboxDrainer } from './tag-stream-outbox-drainer.js'
import { rewriteLoopbackWebhookUrl } from './webhook-url.js'
import {
  applyElectricUrlQueryParams,
  electricUrlWithPath,
} from './electric-url.js'
import type { RuntimeRegistry } from './runtime-registry.js'
import type { WakeRegistration } from './wake-registry.js'
import type {
  AuthenticatedRequestUser,
  AuthenticateRequest,
  ElectricAgentsEntity,
  SourceStreamOffset,
} from './electric-agents-types.js'
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
  /**
   * Optional host-provided user identity hook for local-runner safety checks.
   * Broad auth/policy remains host-owned; Agents Server only uses this to
   * ensure runner-target spawn/acquire requests act as the runner owner.
   */
  authenticateRequest?: AuthenticateRequest
  /**
   * Disabled by default. When set to a positive interval, periodically
   * recovers expired dispatch claims and stale outstanding wakes.
   */
  dispatchRecoveryIntervalMs?: number
  /**
   * Age threshold for outstanding wakes recovered by the periodic loop.
   * Defaults to dispatchRecoveryIntervalMs when periodic recovery is enabled.
   */
  staleOutstandingWakeAfterMs?: number
}

interface MockAgentBootstrap {
  handler: RuntimeHandler[`onEnter`]
  runtime: RuntimeHandler
  registry: EntityRegistry
}

interface ActiveClaimWriteToken {
  token: string
  consumerId: string
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
  private runtimeRegistry: RuntimeRegistry = createRuntimeRegistry()
  private registry: PostgresRegistry | null = null
  private dispatchWakeRouter: DispatchWakeRouter | null = null
  private pgDb: DrizzleDB | null = null
  private pgClient: PgClient | null = null
  private scheduler: Scheduler | null = null
  private entityBridgeManager: EntityBridgeManager | null = null
  private tagStreamOutboxDrainer: TagStreamOutboxDrainer | null = null
  private mockAgentBootstrap: MockAgentBootstrap | null = null
  private _url: string | null = null
  private shuttingDown = false
  private streamsAgent: Agent | null = null
  private activeClaimWriteTokens = new Map<string, ActiveClaimWriteToken>()
  private activeClaimWriteTokensByConsumer = new Map<string, string>()
  private dispatchRecoveryTimer: ReturnType<typeof setInterval> | null = null
  private dispatchRecoveryRunning = false
  private dispatchRecoveryActivePromise: Promise<void> | null = null

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
          const registry = this.registry
          this.dispatchWakeRouter = new DispatchWakeRouter({
            streamClient: this.streamClient,
            registry,
            materializeWake: async ({
              entity,
              target,
              notification,
              runnerWakeStream,
            }) => {
              if (!entity) {
                throw new Error(
                  `Dispatch wake materialization requires an entity`
                )
              }
              return await registry.beginDispatchWake({
                entityUrl: entity.url,
                target,
                notification,
                sourceStreams: notification.streams,
                reason: notification.triggerEvent,
                runnerWakeStream,
              })
            },
            markWakeDelivered: async ({
              wakeId,
              runnerWakeStream,
              runnerWakeStreamOffset,
            }) => {
              await registry.markWakeDelivered({
                wakeId,
                runnerWakeStream,
                runnerWakeStreamOffset,
              })
            },
            markWakeFailed: async ({ wakeId }) => {
              await registry.markWakeFailed({ wakeId })
            },
            callbackUrlForNotification: async (notification) => {
              await registry.upsertConsumerCallback({
                consumerId: notification.consumerId,
                callbackUrl: notification.callback,
                primaryStream: notification.streamPath,
              })
              return `${this.publicUrl}${callbackForwardPathForConsumer(
                notification.consumerId
              )}`
            },
          })

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
          this.electricAgentsManager.setWriteTokenValidator((entity, token) =>
            this.isValidEntityWriteToken(
              entity.streams.main,
              entity.write_token,
              token
            )
          )
          this.electricAgentsManager.setEntityAppendCallback((entity, event) =>
            this.dispatchWakeForEntityAppend(entity, event)
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
          this.startDispatchRecoveryLoop()

          this.electricAgentsRoutes = new ElectricAgentsRoutes(
            this.electricAgentsManager,
            {
              streamClient: this.streamClient,
              authenticateRequest: this.options.authenticateRequest,
              onEntityKilled: (entityUrl) => {
                this.clearActiveClaimForStream(`${entityUrl}/main`)
              },
            }
          )
          this.electricAgentsEntityTypeRoutes =
            new ElectricAgentsEntityTypeRoutes(
              this.electricAgentsManager,
              this.runtimeRegistry
            )

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

  async recoverExpiredDispatchClaimsOnce(input?: {
    now?: Date
    limit?: number
  }): Promise<Array<ExpiredActiveClaimRecoveryItem>> {
    const registry = this.registry
    if (!registry) return []

    const recovered = await registry.expireStaleActiveClaims(input)
    await Promise.all(
      recovered.map(async (item) => {
        if (item.pendingSourceStreams.length === 0) return

        try {
          const entity = await registry.getEntity(item.entityUrl)
          if (!entity?.dispatch_policy) return

          await this.dispatchWakeForPending(entity, item.pendingSourceStreams, {
            triggerEvent: item.pendingReason ?? `expired_claim_recovery`,
          })
        } catch (err) {
          serverLog.warn(
            `[agent-server] expired claim recovery dispatch failed for ${item.entityUrl}:`,
            err
          )
        }
      })
    )

    return recovered
  }

  async recoverStaleOutstandingWakesOnce(input: {
    staleBefore: Date
    now?: Date
    limit?: number
  }): Promise<Array<StaleOutstandingWakeRecoveryItem>> {
    const registry = this.registry
    if (!registry) return []

    const recovered = await registry.expireStaleOutstandingWakes(input)
    await Promise.all(
      recovered.map(async (item) => {
        try {
          const entity = await registry.getEntity(item.entityUrl)
          if (!entity?.dispatch_policy) return

          await this.dispatchWakeForPending(entity, item.pendingSourceStreams, {
            triggerEvent: item.pendingReason ?? `stale_outstanding_wake`,
          })
        } catch (err) {
          serverLog.warn(
            `[agent-server] stale outstanding wake recovery dispatch failed for ${item.entityUrl} wake=${item.wakeId}:`,
            err
          )
        }
      })
    )

    return recovered
  }

  private startDispatchRecoveryLoop(): void {
    this.stopDispatchRecoveryLoop()

    const intervalMs = this.options.dispatchRecoveryIntervalMs
    if (!intervalMs || intervalMs <= 0) return

    const staleAfterMs =
      this.options.staleOutstandingWakeAfterMs &&
      this.options.staleOutstandingWakeAfterMs > 0
        ? this.options.staleOutstandingWakeAfterMs
        : intervalMs

    const run = async (): Promise<void> => {
      if (this.shuttingDown || this.dispatchRecoveryRunning) return

      this.dispatchRecoveryRunning = true
      const now = new Date()
      try {
        await this.recoverExpiredDispatchClaimsOnce({ now })
        await this.recoverStaleOutstandingWakesOnce({
          now,
          staleBefore: new Date(now.getTime() - staleAfterMs),
        })
      } catch (err) {
        serverLog.warn(`[agent-server] dispatch recovery loop failed:`, err)
      } finally {
        this.dispatchRecoveryRunning = false
      }
    }

    this.dispatchRecoveryTimer = setInterval(() => {
      if (this.shuttingDown || this.dispatchRecoveryRunning) return

      const activePromise = run().finally(() => {
        if (this.dispatchRecoveryActivePromise === activePromise) {
          this.dispatchRecoveryActivePromise = null
        }
      })
      this.dispatchRecoveryActivePromise = activePromise
      void activePromise
    }, intervalMs)
    this.dispatchRecoveryTimer.unref?.()
  }

  private stopDispatchRecoveryLoop(): void {
    if (!this.dispatchRecoveryTimer) return
    clearInterval(this.dispatchRecoveryTimer)
    this.dispatchRecoveryTimer = null
  }

  private async drainDispatchRecoveryLoop(): Promise<void> {
    const activePromise = this.dispatchRecoveryActivePromise
    if (!activePromise) return

    try {
      await activePromise
    } catch (err) {
      // The recovery runner catches/logs its own errors, but keep shutdown
      // defensive so recovery cleanup cannot prevent normal server stop.
      serverLog.warn(
        `[agent-server] dispatch recovery loop failed during shutdown:`,
        err
      )
    }
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    this.stopDispatchRecoveryLoop()
    await this.drainDispatchRecoveryLoop()

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
      this.dispatchWakeRouter = null
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
      `content-type, authorization, electric-claim-token, electric-runner-id, x-runner-id, ngrok-skip-browser-warning`
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

    if (path === `/api/runtimes` && method === `GET`) {
      sendJson(res, 200, {
        runtimes: this.runtimeRegistry.list(),
        experimental: true,
      })
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
      let opts: {
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
      try {
        opts = JSON.parse(new TextDecoder().decode(body))
      } catch {
        res.writeHead(400, { 'content-type': `application/json` })
        res.end(JSON.stringify({ error: `invalid wake registration body` }))
        return
      }
      try {
        await this.electricAgentsManager.registerWake(opts)
        res.writeHead(204)
        res.end()
      } catch (err) {
        serverLog.error(`[agent-server] wake registration failed:`, err)
        res.writeHead(500, { 'content-type': `application/json` })
        res.end(JSON.stringify({ error: `wake registration failed` }))
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

  private isValidEntityWriteToken(
    streamPath: string,
    _entityWriteToken: string,
    token: string
  ): boolean {
    const activeClaim = this.activeClaimWriteTokens.get(streamPath)
    return activeClaim?.token === token
  }

  private clearActiveClaimForStream(streamPath: string): void {
    const activeClaim = this.activeClaimWriteTokens.get(streamPath)
    if (!activeClaim) return

    this.activeClaimWriteTokens.delete(streamPath)
    this.activeClaimWriteTokensByConsumer.delete(activeClaim.consumerId)
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
      if (!this.isValidEntityWriteToken(path, entity.write_token, token)) {
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
      void this.dispatchWakeForEntityAppend(entity, event).catch((err) =>
        serverLog.warn(
          `[agent-server] dispatch wake for entity append failed:`,
          err
        )
      )
    }

    return true
  }

  private async dispatchWakeForEntityAppend(
    entity: ElectricAgentsEntity,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (isOnlyEntityCreatedEvent(event)) return

    let streams: Array<SourceStreamOffset> | undefined
    try {
      const offset = await this.streamClient.headOffset(entity.streams.main)
      if (offset !== null) {
        streams = [{ path: entity.streams.main, offset }]
      }
    } catch (err) {
      serverLog.warn(
        `[agent-server] failed to read append offset for dispatch wake ${entity.url}:`,
        err
      )
    }

    await this.dispatchWakeForPending(entity, streams, {
      triggerEvent: inferDispatchTriggerEvent(event),
    })
  }

  private async dispatchWakeForPending(
    entity: ElectricAgentsEntity,
    pendingSourceStreams?: Array<SourceStreamOffset>,
    options?: { triggerEvent?: string }
  ): Promise<void> {
    const router = this.dispatchWakeRouter
    if (!router || !entity.dispatch_policy) return

    try {
      const target = router.resolveSingleTarget(entity.dispatch_policy)
      if (!target) return

      if (target.type === `worker-pool`) {
        serverLog.info(
          `[agent-server] worker-pool dispatch target skipped for ${entity.url}; worker pools are not wired yet`
        )
        return
      }

      const triggerEvent =
        options?.triggerEvent ??
        (pendingSourceStreams ? `pending_coalesced_wake` : undefined)
      const minted = await this.mintDispatchWakeNotificationWithRetry(entity, {
        ...(pendingSourceStreams ? { streams: pendingSourceStreams } : {}),
        ...(triggerEvent ? { triggerEvent } : {}),
      })
      const notification = await router.enrichNotificationForEntity(
        minted.notification,
        entity
      )
      await router.dispatchToTarget(target, notification, entity)
    } catch (err) {
      serverLog.warn(
        `[agent-server] dispatch wake failed for ${entity.url}:`,
        err
      )
    }
  }

  private async mintDispatchWakeNotificationWithRetry(
    entity: ElectricAgentsEntity,
    options: { streams?: Array<SourceStreamOffset>; triggerEvent?: string }
  ): Promise<
    Awaited<ReturnType<DispatchWakeRouter[`mintNotificationForEntity`]>>
  > {
    const router = this.dispatchWakeRouter
    if (!router) {
      throw new Error(`Dispatch wake router not configured`)
    }

    let lastErr: unknown
    const delays = [25, 50, 100, 200, 400, 800, 1600, 3200]
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await router.mintNotificationForEntity(entity, options)
      } catch (err) {
        lastErr = err
        if (
          !isWakeNotificationStreamNotFoundError(err) ||
          attempt === delays.length
        ) {
          throw err
        }
        await delay(delays[attempt]!)
      }
    }

    throw lastErr
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
          this.registry && consumerId && callbackUrl
            ? tracer
                .startActiveSpan(`db.upsertConsumerCallback`, async (span) => {
                  try {
                    await this.registry!.upsertConsumerCallback({
                      consumerId,
                      callbackUrl,
                      primaryStream,
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
        }

        if (consumerId && callbackUrl) {
          enriched.callback = `${publicUrl}/_electric/callback-forward/${encodeURIComponent(consumerId)}`
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

  private async authenticateIncomingRequest(
    req: IncomingMessage
  ): Promise<AuthenticatedRequestUser | null> {
    const authenticateRequest = this.options.authenticateRequest
    if (!authenticateRequest) return null

    try {
      const user = await authenticateRequest(req)
      if (
        !user ||
        typeof user.userId !== `string` ||
        user.userId.length === 0
      ) {
        return null
      }
      return user
    } catch (err) {
      serverLog.warn(
        `[agent-server] authenticateRequest failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return null
    }
  }

  private async authorizeCallbackForwardClaim(
    req: IncomingMessage,
    res: ServerResponse,
    primaryStream: string
  ): Promise<boolean> {
    const entity =
      await this.electricAgentsManager!.registry.getEntityByStream(
        primaryStream
      )
    const target = entity?.dispatch_policy?.targets[0]
    if (!entity || target?.type !== `runner`) {
      return true
    }

    if (!this.options.authenticateRequest) {
      sendJsonError(
        res,
        401,
        `AUTHENTICATION_REQUIRED`,
        `Authentication is required to acquire runner-targeted work`
      )
      return false
    }

    const user = await this.authenticateIncomingRequest(req)
    if (!user) {
      sendJsonError(
        res,
        401,
        `AUTHENTICATION_REQUIRED`,
        `Authentication is required to acquire runner-targeted work`
      )
      return false
    }

    const requestRunnerId = readRunnerIdHeader(req)
    if (requestRunnerId !== target.runnerId) {
      sendJsonError(
        res,
        403,
        `RUNNER_MISMATCH`,
        `Runner id header must match the entity dispatch target`
      )
      return false
    }

    const runner = await this.electricAgentsManager!.registry.getRunner(
      target.runnerId
    )
    if (!runner) {
      sendJsonError(res, 404, `NOT_FOUND`, `Runner not found`)
      return false
    }
    if (runner.admin_status !== `enabled`) {
      sendJsonError(res, 403, `RUNNER_DISABLED`, `Runner is disabled`)
      return false
    }
    if (runner.owner_user_id !== user.userId) {
      sendJsonError(
        res,
        403,
        `FORBIDDEN`,
        `Authenticated user does not own the target runner`
      )
      return false
    }

    return true
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

    if (isClaimRequest && target.primaryStream) {
      const authorized = await this.authorizeCallbackForwardClaim(
        req,
        res,
        target.primaryStream
      )
      if (!authorized) return
    }

    const headers = this.buildForwardHeaders(req)
    const claimToken = headers.get(`electric-claim-token`)?.trim()
    if (claimToken) {
      headers.set(
        `authorization`,
        `Bearer ${claimToken.replace(/^Bearer\s+/i, ``)}`
      )
      headers.delete(`electric-claim-token`)
    }
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
    const responseBody = decodeJsonObject(responseBytes)
    const requestEpoch = readIntegerField(requestBody, `epoch`)
    const isDoneRequest = requestBody?.done === true
    const isHeartbeatRequest =
      requestEpoch !== undefined && !isClaimRequest && !isDoneRequest

    if (isClaimRequest && upstream.ok && target.primaryStream) {
      if (
        responseBody &&
        responseBody.error === undefined &&
        responseBody.ok !== false
      ) {
        const entity =
          await this.electricAgentsManager!.registry.getEntityByStream(
            target.primaryStream
          )
        if (entity) {
          const writeToken = randomUUID()
          const previousClaimForStream = this.activeClaimWriteTokens.get(
            target.primaryStream
          )
          if (previousClaimForStream) {
            this.activeClaimWriteTokensByConsumer.delete(
              previousClaimForStream.consumerId
            )
          }
          const previousStreamForConsumer =
            this.activeClaimWriteTokensByConsumer.get(consumerId)
          if (previousStreamForConsumer) {
            this.activeClaimWriteTokens.delete(previousStreamForConsumer)
          }
          this.activeClaimWriteTokens.set(target.primaryStream, {
            token: writeToken,
            consumerId,
          })
          this.activeClaimWriteTokensByConsumer.set(
            consumerId,
            target.primaryStream
          )
          responseBody.writeToken = writeToken
          responseBytes = new TextEncoder().encode(JSON.stringify(responseBody))
          if (entity.status !== `stopped`) {
            try {
              await this.electricAgentsManager!.registry.updateStatus(
                entity.url,
                `running`
              )
            } catch (err) {
              serverLog.error(
                `[callback-forward] error updating status to running for ${entity.url}: ${err instanceof Error ? err.message : String(err)}`
              )
            }

            const epoch = readIntegerField(requestBody, responseBody, `epoch`)
            if (epoch !== undefined) {
              try {
                await this.electricAgentsManager!.registry.materializeActiveClaim(
                  {
                    consumerId,
                    epoch,
                    entityUrl: entity.url,
                    streamPath: target.primaryStream,
                    wakeId: readStringField(
                      requestBody,
                      responseBody,
                      `wakeId`,
                      `wake_id`
                    ),
                    runnerId: readRunnerId(req, requestBody, responseBody),
                    leaseExpiresAt: readDateField(
                      responseBody,
                      requestBody,
                      `leaseExpiresAt`,
                      `lease_expires_at`,
                      `leaseExpires`,
                      `lease_expires`,
                      `activeLeaseExpiresAt`,
                      `active_lease_expires_at`
                    ),
                  }
                )
              } catch (err) {
                serverLog.error(
                  `[callback-forward] error materializing active claim for ${entity.url} consumer=${consumerId} epoch=${epoch}: ${err instanceof Error ? err.message : String(err)}`
                )
              }
            }
          }
        }
      }
    }

    if (isHeartbeatRequest && upstream.ok && target.primaryStream) {
      try {
        const entity =
          await this.electricAgentsManager!.registry.getEntityByStream(
            target.primaryStream
          )
        if (entity) {
          const matched =
            await this.electricAgentsManager!.registry.materializeHeartbeatClaim(
              {
                consumerId,
                epoch: requestEpoch,
                entityUrl: entity.url,
                streamPath: target.primaryStream,
                leaseExpiresAt: readDateField(
                  responseBody,
                  requestBody,
                  `leaseExpiresAt`,
                  `lease_expires_at`,
                  `leaseExpires`,
                  `lease_expires`,
                  `activeLeaseExpiresAt`,
                  `active_lease_expires_at`
                ),
              }
            )
          if (!matched) {
            serverLog.warn(
              `[callback-forward] heartbeat did not match active claim for ${entity.url} consumer=${consumerId} epoch=${requestEpoch}`
            )
          }
        } else {
          serverLog.warn(
            `[callback-forward] heartbeat received but no entity found for stream=${target.primaryStream}`
          )
        }
      } catch (err) {
        serverLog.error(
          `[callback-forward] error materializing heartbeat for consumer=${consumerId} epoch=${requestEpoch}: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    try {
      if (upstream.ok && isDoneRequest && target.primaryStream) {
        serverLog.info(
          `[callback-forward] done received for stream=${target.primaryStream} consumer=${consumerId}`
        )
        const activeClaim = this.activeClaimWriteTokens.get(
          target.primaryStream
        )
        const stillOwnsClaim = activeClaim?.consumerId === consumerId
        const entity =
          await this.electricAgentsManager!.registry.getEntityByStream(
            target.primaryStream
          )
        if (entity) {
          if (requestEpoch === undefined) {
            serverLog.warn(
              `[callback-forward] done missing epoch; skipping release materialization and idle status for ${entity.url} consumer=${consumerId}`
            )
          } else {
            let releaseMatched = false
            let pendingSourceStreams: Array<SourceStreamOffset> = []
            let pendingReason: string | undefined
            try {
              const releaseResult =
                await this.electricAgentsManager!.registry.materializeReleasedClaim(
                  {
                    consumerId,
                    epoch: requestEpoch,
                    entityUrl: entity.url,
                    streamPath: target.primaryStream,
                    ackedStreams: readSourceStreamsField(
                      requestBody,
                      `acks`,
                      `ackedStreams`,
                      `acked_streams`
                    ),
                  }
                )
              releaseMatched = releaseResult.matched
              pendingSourceStreams = releaseResult.pendingSourceStreams
              pendingReason = releaseResult.pendingReason
            } catch (err) {
              serverLog.error(
                `[callback-forward] error materializing released claim for ${entity.url} consumer=${consumerId} epoch=${requestEpoch}: ${err instanceof Error ? err.message : String(err)}`
              )
            }

            if (releaseMatched && (stillOwnsClaim || !activeClaim)) {
              if (entity.status !== `stopped`) {
                try {
                  await this.electricAgentsManager!.registry.updateStatus(
                    entity.url,
                    `idle`
                  )
                  serverLog.info(
                    `[callback-forward] status updated to idle for ${entity.url}`
                  )
                } catch (err) {
                  serverLog.error(
                    `[callback-forward] error updating status to idle for ${entity.url}: ${err instanceof Error ? err.message : String(err)}`
                  )
                }
              }
              this.clearActiveClaimForStream(target.primaryStream)
              await this.entityBridgeManager?.onEntityChanged(entity.url)

              if (pendingSourceStreams.length > 0 && entity.dispatch_policy) {
                void this.dispatchWakeForPending(entity, pendingSourceStreams, {
                  triggerEvent: pendingReason,
                }).catch((err) =>
                  serverLog.warn(
                    `[callback-forward] pending dispatch wake failed for ${entity.url}:`,
                    err
                  )
                )
              }
            } else if (releaseMatched) {
              serverLog.info(
                `[callback-forward] done ignored for stale claim stream=${target.primaryStream} consumer=${consumerId}`
              )
            } else {
              serverLog.warn(
                `[callback-forward] stale done skipped idle/status clear for ${entity.url} consumer=${consumerId} epoch=${requestEpoch}`
              )
            }
          }
        } else {
          serverLog.warn(
            `[callback-forward] done received but no entity found for stream=${target.primaryStream}`
          )
        }
      } else if (isDoneRequest) {
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
        `"url","type","status","dispatch_policy","tags","spawn_args","parent","type_revision","inbox_schemas","state_schemas","created_at","updated_at"`
      )
    } else if (table === `entity_types`) {
      target.searchParams.set(
        `columns`,
        `"name","description","creation_schema","inbox_schemas","state_schemas","serve_endpoint","default_dispatch_policy","revision","created_at","updated_at"`
      )
    } else if (table === `users`) {
      target.searchParams.set(
        `columns`,
        `"id","display_name","email","avatar_url","created_at","updated_at"`
      )
    } else if (table === `runners`) {
      target.searchParams.set(
        `columns`,
        `"id","owner_user_id","label","kind","admin_status","wake_stream","last_seen_at","liveness_lease_expires_at","created_at","updated_at"`
      )
    } else if (table === `entity_dispatch_state`) {
      target.searchParams.set(
        `columns`,
        `"entity_url","pending_source_streams","pending_reason","pending_since","outstanding_wake_id","outstanding_wake_target","outstanding_wake_created_at","active_consumer_id","active_runner_id","active_epoch","active_claimed_at","active_lease_expires_at","last_wake_id","last_claimed_at","last_released_at","last_completed_at","last_error","updated_at"`
      )
    } else if (table === `wake_notifications`) {
      target.searchParams.set(
        `columns`,
        `"wake_id","entity_url","target_type","target_runner_id","target_worker_pool_id","runner_wake_stream","runner_wake_stream_offset","notification_public","delivery_status","claim_status","created_at","delivered_at","claimed_at","resolved_at"`
      )
    } else if (table === `consumer_claims`) {
      target.searchParams.set(
        `columns`,
        `"consumer_id","epoch","wake_id","entity_url","stream_path","runner_id","status","claimed_at","last_heartbeat_at","lease_expires_at","released_at","acked_streams","updated_at"`
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

function isWakeNotificationStreamNotFoundError(err: unknown): boolean {
  return (
    err instanceof Error &&
    /Wake notification mint failed/.test(err.message) &&
    /:\s*404\s+Stream not found/i.test(err.message)
  )
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isOnlyEntityCreatedEvent(
  event: Record<string, unknown> | Array<Record<string, unknown>>
): boolean {
  const events = Array.isArray(event) ? event : [event]
  return (
    events.length > 0 && events.every((item) => item.type === `entity_created`)
  )
}

function inferDispatchTriggerEvent(
  event: Record<string, unknown> | Array<Record<string, unknown>>
): string | undefined {
  const events = Array.isArray(event) ? event : [event]
  for (const item of events) {
    const eventType = item.type
    if (typeof eventType === `string` && eventType.length > 0) {
      return eventType
    }
  }
  return undefined
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

function splitFieldLookupArgs(
  args: Array<Record<string, unknown> | null | undefined | string>
): {
  sources: Array<Record<string, unknown>>
  fields: Array<string>
} {
  const sources: Array<Record<string, unknown>> = []
  const fields: Array<string> = []
  for (const arg of args) {
    if (!arg) continue
    if (typeof arg === `string`) {
      fields.push(arg)
    } else {
      sources.push(arg)
    }
  }
  return { sources, fields }
}

function readStringField(
  ...args: Array<Record<string, unknown> | null | undefined | string>
): string | undefined {
  const { sources, fields } = splitFieldLookupArgs(args)
  for (const source of sources) {
    for (const field of fields) {
      const value = source[field]
      if (typeof value === `string` && value.length > 0) {
        return value
      }
    }
  }
  return undefined
}

function readIntegerField(
  ...args: Array<Record<string, unknown> | null | undefined | string>
): number | undefined {
  const { sources, fields } = splitFieldLookupArgs(args)
  for (const source of sources) {
    for (const field of fields) {
      const value = source[field]
      const parsed =
        typeof value === `number`
          ? value
          : typeof value === `string`
            ? Number(value)
            : Number.NaN
      if (Number.isInteger(parsed)) {
        return parsed
      }
    }
  }
  return undefined
}

function readDateField(
  ...args: Array<Record<string, unknown> | null | undefined | string>
): Date | undefined {
  const { sources, fields } = splitFieldLookupArgs(args)
  for (const source of sources) {
    for (const field of fields) {
      const value = source[field]
      const date =
        typeof value === `string` || typeof value === `number`
          ? new Date(value)
          : undefined
      if (date && !Number.isNaN(date.getTime())) {
        return date
      }
    }
  }
  return undefined
}

function readSourceStreamsField(
  source: Record<string, unknown> | null | undefined,
  ...fields: Array<string>
): Array<SourceStreamOffset> | undefined {
  if (!source) return undefined
  for (const field of fields) {
    const value = source[field]
    if (!Array.isArray(value)) continue
    const streams: Array<SourceStreamOffset> = []
    for (const item of value) {
      if (!item || typeof item !== `object` || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      const path = record.path
      const offset = record.offset
      if (typeof path !== `string`) continue
      if (
        typeof offset !== `string` &&
        typeof offset !== `number` &&
        typeof offset !== `bigint`
      ) {
        continue
      }
      streams.push({ path, offset: String(offset) })
    }
    return streams
  }
  return undefined
}

function readRunnerIdHeader(req: IncomingMessage): string | undefined {
  for (const header of [`electric-runner-id`, `x-runner-id`]) {
    const value = req.headers[header]
    if (typeof value === `string` && value.length > 0) {
      return value
    }
    if (Array.isArray(value) && typeof value[0] === `string`) {
      return value[0]
    }
  }
  return undefined
}

function readRunnerId(
  req: IncomingMessage,
  ...bodies: Array<Record<string, unknown> | null | undefined>
): string | undefined {
  const headerRunnerId = readRunnerIdHeader(req)
  if (headerRunnerId) return headerRunnerId

  return readStringField(
    ...bodies,
    `runnerId`,
    `runner_id`,
    `activeRunnerId`,
    `active_runner_id`
  )
}
