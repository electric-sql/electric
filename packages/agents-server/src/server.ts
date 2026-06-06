import { createServer } from 'node:http'
import { createServerAdapter } from '@whatwg-node/server'
import { Agent } from 'undici'
import {
  appendPathToUrl,
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import { createDb, runMigrations } from './db/index.js'
import { ossServerRouter } from './routing/oss-server-router.js'
import { startStandaloneAgentsRuntime } from './standalone-runtime.js'
import { StreamClient } from './stream-client.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import { getDevPrincipal, getPrincipalFromRequest } from './principal.js'
import { apiError } from './electric-agents-http.js'
import {
  ErrCodeInvalidRequest,
  ErrCodeUnauthorized,
  type AuthorizeRequest,
} from './electric-agents-types.js'
import { ElectricAgentsError } from './entity-manager.js'
import { serverLog } from './utils/log.js'
import { createEd25519WebhookSigner } from './webhook-signing.js'
import type { DrizzleDB, PgClient } from './db/index.js'
import type { Server } from 'node:http'
import type { DurableStreamTestServer } from '@durable-streams/server'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import type {
  AgentModel,
  EntityRegistry,
  RuntimeHandler,
  WebhookSignatureVerifierConfig,
} from '@electric-ax/agents-runtime'
import type { Principal } from './principal.js'
import type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
import type { DurableStreamsRoutingAdapter } from './routing/durable-streams-routing-adapter.js'
import type { OssServerContext } from './routing/oss-server-router.js'
import type { EventSourceCatalog } from './routing/context.js'
import type { PgSyncBridgeManagerOptions } from './pg-sync-bridge-manager.js'
import type { StartedStandaloneAgentsRuntime } from './standalone-runtime.js'
import type { DurableStreamsBearerProvider } from './stream-client.js'
import type {
  WebhookSigner,
  WebhookSigningKeyInput,
} from './webhook-signing.js'

const MOCK_AGENT_HANDLER_PATH = `/_electric/mock-agent-handler`

export interface ElectricAgentsServerOptions {
  service?: string
  tenantId?: string
  baseUrl?: string
  durableStreamsUrl?: string
  durableStreamsBearer?: DurableStreamsBearerProvider
  durableStreamsRouting?: DurableStreamsRoutingAdapter
  durableStreamsServer?: DurableStreamTestServer
  durableStreamsWebhookSignature?:
    | false
    | Partial<WebhookSignatureVerifierConfig>
  webhookSigner?: WebhookSigner
  webhookSigningKey?: WebhookSigningKeyInput
  port: number
  host?: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  postgresUrl: string
  electricUrl?: string
  electricSecret?: string
  authenticateRequest?: (
    request: Request
  ) => Promise<Principal | null> | Principal | null
  authorizeRequest?: AuthorizeRequest
  allowDevPrincipalFallback?: boolean
  eventSources?: EventSourceCatalog
  ensureEventSourceWakeSource?: (sourceUrl: string) => Promise<void> | void
  pgSync?: PgSyncBridgeManagerOptions
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
    serveEndpoint: appendPathToUrl(
      options.agentServerUrl,
      MOCK_AGENT_HANDLER_PATH
    ),
    registry,
    subscriptionPathForType: (name) => `/${name}/*/main`,
    idleTimeout: 100,
  })

  return { runtime, registry }
}

function durableStreamTestServerBackendUrl(origin: string): string {
  // DurableStreamTestServer.start() returns the HTTP origin, while the
  // reference server's stream backend is mounted under /v1/stream.
  // User-provided durableStreamsUrl values are already backend prefixes and
  // are passed through unchanged.
  const url = new URL(origin)
  url.pathname = `${url.pathname.replace(/\/+$/, ``)}/v1/stream`
  return url.toString().replace(/\/+$/, ``)
}

export class ElectricAgentsServer {
  private server?: Server
  private electricAgentsManager?: StartedStandaloneAgentsRuntime[`manager`]
  private pgDb?: DrizzleDB
  private pgClient?: PgClient
  private entityBridgeManager?: EntityBridgeCoordinator
  private mockAgentBootstrap?: MockAgentBootstrap
  private _url?: string
  private shuttingDown = false
  private streamsAgent?: Agent
  private standaloneRuntime?: StartedStandaloneAgentsRuntime
  private readonly webhookSigner: WebhookSigner

  streamClient: StreamClient
  readonly options: ElectricAgentsServerOptions

  constructor(options: ElectricAgentsServerOptions) {
    if (!options.durableStreamsUrl && !options.durableStreamsServer) {
      throw new Error(
        `Either durableStreamsUrl or durableStreamsServer is required`
      )
    }
    this.options = options
    this.webhookSigner =
      options.webhookSigner ??
      createEd25519WebhookSigner({ privateKey: options.webhookSigningKey })
    this.streamClient = options.durableStreamsUrl
      ? new StreamClient(options.durableStreamsUrl, {
          bearer: options.durableStreamsBearer,
        })
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

  private get tenantId(): string {
    return this.options.service ?? this.options.tenantId ?? DEFAULT_TENANT_ID
  }

  async start(): Promise<string> {
    if (this.server) {
      throw new Error(`Server already started`)
    }

    try {
      if (
        this.options.durableStreamsServer &&
        !this.options.durableStreamsUrl
      ) {
        serverLog.info(`[agent-server] starting durable streams server...`)
        const streamsUrl = await this.options.durableStreamsServer.start()
        serverLog.info(
          `[agent-server] durable streams server started at ${streamsUrl}`
        )
        this.options.durableStreamsUrl =
          durableStreamTestServerBackendUrl(streamsUrl)
        this.streamClient = new StreamClient(this.options.durableStreamsUrl, {
          bearer: this.options.durableStreamsBearer,
        })
      }

      this.streamsAgent = new Agent({
        keepAliveTimeout: 60_000,
        keepAliveMaxTimeout: 600_000,
        connections: 256,
        pipelining: 1,
        bodyTimeout: 0,
        headersTimeout: 0,
      })

      serverLog.info(`[agent-server] running migrations...`)
      await runMigrations(this.options.postgresUrl)
      serverLog.info(`[agent-server] migrations complete`)
      const { db, client } = createDb(this.options.postgresUrl)
      this.pgDb = db
      this.pgClient = client

      this.standaloneRuntime = await startStandaloneAgentsRuntime({
        service: this.tenantId,
        db,
        pgClient: client,
        streamClient: this.streamClient,
        electricUrl: this.options.electricUrl,
        electricSecret: this.options.electricSecret,
        pgSync: this.options.pgSync,
      })
      this.electricAgentsManager = this.standaloneRuntime.manager
      this.entityBridgeManager = this.standaloneRuntime.entityBridgeManager
      await this.electricAgentsManager.ensurePrincipalEntityType()

      const serverAdapter = createServerAdapter((request) =>
        this.handleRequest(request)
      )
      const server = createServer(serverAdapter)
      this.server = server

      const host = this.options.host ?? `127.0.0.1`
      await this.listen(server, host)

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

      return this.url
    } catch (err) {
      await this.stop().catch(() => {})
      throw err
    }
  }

  async stop(): Promise<void> {
    this.shuttingDown = true

    if (this.server) {
      const server = this.server
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections?.()
        server.closeAllConnections?.()
      })
      this.server = undefined
      this._url = undefined
    }

    if (this.mockAgentBootstrap) {
      this.mockAgentBootstrap.runtime.abortWakes()
      await Promise.race([
        this.mockAgentBootstrap.runtime.drainWakes().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ])
      this.mockAgentBootstrap = undefined
    }

    if (this.standaloneRuntime) {
      await this.standaloneRuntime.stop()
      this.standaloneRuntime = undefined
      this.entityBridgeManager = undefined
      this.electricAgentsManager = undefined
    }

    if (this.options.durableStreamsServer) {
      await this.options.durableStreamsServer.stop()
    }

    if (this.pgClient) {
      await this.pgClient.end()
      this.pgClient = undefined
      this.pgDb = undefined
    }

    if (this.streamsAgent) {
      await this.streamsAgent.close().catch(() => {})
      this.streamsAgent = undefined
    }

    this.shuttingDown = false
  }

  private async listen(server: Server, host: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        server.off?.(`listening`, onListening)
        reject(err)
      }
      const onListening = (): void => {
        server.off?.(`error`, onError)
        resolve()
      }

      server.once?.(`error`, onError) ?? server.on(`error`, onError)
      server.listen(this.options.port, host, onListening)
    })

    const addr = server.address()
    if (typeof addr === `string`) {
      this._url = addr
    } else if (addr) {
      const resolvedHost = host === `0.0.0.0` ? `127.0.0.1` : host
      this._url = `http://${resolvedHost}:${addr.port}`
    } else {
      throw new Error(`Could not determine server address`)
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (
      !this._url ||
      !this.standaloneRuntime ||
      !this.electricAgentsManager ||
      !this.entityBridgeManager ||
      !this.pgDb ||
      !this.streamsAgent ||
      !this.options.durableStreamsUrl
    ) {
      return new Response(null, { status: 503 })
    }

    try {
      return await ossServerRouter.fetch(
        request as Parameters<typeof ossServerRouter.fetch>[0],
        await this.buildTenantContext(request)
      )
    } catch (error) {
      if (error instanceof ElectricAgentsError) {
        return apiError(error.status, error.code, error.message, error.details)
      }
      throw error
    }
  }

  private allowDevPrincipalFallback(): boolean {
    if (this.options.allowDevPrincipalFallback !== undefined) {
      return this.options.allowDevPrincipalFallback
    }
    return (
      process.env.ELECTRIC_INSECURE === `true` ||
      process.env.NODE_ENV !== `production` ||
      Boolean(this.options.durableStreamsServer)
    )
  }

  private async buildTenantContext(
    request: Request
  ): Promise<OssServerContext> {
    if (
      !this.standaloneRuntime ||
      !this.electricAgentsManager ||
      !this.entityBridgeManager ||
      !this.pgDb ||
      !this.streamsAgent ||
      !this.options.durableStreamsUrl
    ) {
      throw new Error(`agents-server runtime is not started`)
    }

    let principal: Principal | null
    try {
      principal =
        (await this.options.authenticateRequest?.(request)) ??
        getPrincipalFromRequest(request)
    } catch (error) {
      throw new ElectricAgentsError(
        ErrCodeInvalidRequest,
        error instanceof Error ? error.message : `Invalid principal`,
        400
      )
    }

    if (!principal && this.allowDevPrincipalFallback()) {
      principal = getDevPrincipal()
    }
    if (!principal) {
      throw new ElectricAgentsError(
        ErrCodeUnauthorized,
        `Missing Electric-Principal`,
        401
      )
    }

    return {
      service: this.tenantId,
      principal,
      publicUrl: this.publicUrl,
      localUrl: this._url,
      durableStreamsUrl: this.options.durableStreamsUrl!,
      durableStreamsBearer: this.options.durableStreamsBearer,
      durableStreamsRouting: this.options.durableStreamsRouting,
      durableStreamsDispatcher: this.streamsAgent,
      durableStreamsWebhookSignature:
        this.options.durableStreamsWebhookSignature,
      webhookSigner: this.webhookSigner,
      electricUrl: this.options.electricUrl,
      electricSecret: this.options.electricSecret,
      ownAgentHandlerPaths: this.mockAgentBootstrap
        ? [MOCK_AGENT_HANDLER_PATH]
        : undefined,
      pgDb: this.pgDb,
      entityManager: this.electricAgentsManager,
      streamClient: this.streamClient,
      runtime: this.standaloneRuntime.runtime,
      entityBridgeManager: this.entityBridgeManager,
      pgSyncBridgeManager: this.standaloneRuntime.runtime.pgSyncBridgeManager,
      ...(this.options.eventSources
        ? { eventSources: this.options.eventSources }
        : {}),
      ...(this.options.ensureEventSourceWakeSource
        ? {
            ensureEventSourceWakeSource:
              this.options.ensureEventSourceWakeSource,
          }
        : {}),
      ...(this.options.authorizeRequest
        ? { authorizeRequest: this.options.authorizeRequest }
        : {}),
      isShuttingDown: () => this.shuttingDown,
      mockAgent: this.mockAgentBootstrap
        ? { runtime: this.mockAgentBootstrap.runtime }
        : undefined,
    }
  }
}
