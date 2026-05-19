import { randomUUID } from 'node:crypto'
import { PostgresRegistry } from './entity-registry.js'
import { EntityProjector } from './entity-projector.js'
import { ElectricAgentsTenantRuntime } from './runtime.js'
import { PostgresSchedulerClient, Scheduler } from './scheduler.js'
import { StreamClient } from './stream-client.js'
import { TagStreamOutboxDrainer } from './tag-stream-outbox-drainer.js'
import { DEFAULT_TENANT_ID, UnregisteredTenantError } from './tenant.js'
import { WakeRegistry } from './wake-registry.js'
import type { DrizzleDB, PgClient } from './db/index.js'
import type { DurableStreamsBearerProvider } from './stream-client.js'
import type { DurableStreamsRoutingAdapter } from './routing/durable-streams-routing-adapter.js'

export interface AgentsHostTenantConfig {
  serviceId: string
  durableStreamsUrl?: string
  durableStreamsBearer?: DurableStreamsBearerProvider
  /**
   * Routing adapter applied to subscription path payloads so they match the
   * backend stream-path namespace used for appends. Required for cloud /
   * service-routed durable-streams deployments where appends are keyed on a
   * service-prefixed path; safe to omit for tenant-root deployments.
   */
  durableStreamsRouting?: DurableStreamsRoutingAdapter
  streamClient?: StreamClient
}

export type AgentsHostTenantRuntime = ElectricAgentsTenantRuntime

export interface AgentsHostOptions {
  db: DrizzleDB
  pgClient: PgClient
  electricUrl?: string
  electricSecret?: string
  instanceId?: string
  wakeRegistry?: WakeRegistry
  entityProjector?: EntityProjector
  startEntityBridgeManager?: boolean
  rehydrateTenantOnStart?: boolean
}

export class AgentsHost {
  readonly db: DrizzleDB
  readonly pgClient: PgClient
  readonly wakeRegistry: WakeRegistry
  readonly entityProjector: EntityProjector
  readonly scheduler: Scheduler
  readonly tagStreamOutboxDrainer: TagStreamOutboxDrainer

  private readonly electricUrl?: string
  private readonly electricSecret?: string
  private readonly instanceId: string
  private readonly ownsWakeRegistry: boolean
  private readonly ownsEntityProjector: boolean
  private readonly startEntityBridgeManager: boolean
  private readonly rehydrateTenantOnStart: boolean
  private readonly tenantRegistrations = new Map<
    string,
    Promise<AgentsHostTenantRuntime>
  >()
  private readonly tenantRuntimes = new Map<string, AgentsHostTenantRuntime>()
  private readonly tenantOperations = new Map<string, Promise<void>>()
  private running = false

  constructor(options: AgentsHostOptions) {
    this.db = options.db
    this.pgClient = options.pgClient
    this.electricUrl = options.electricUrl
    this.electricSecret = options.electricSecret
    this.instanceId = options.instanceId ?? randomUUID()
    this.ownsWakeRegistry = !options.wakeRegistry
    this.wakeRegistry = options.wakeRegistry ?? new WakeRegistry(this.db, null)
    this.ownsEntityProjector = !options.entityProjector
    this.startEntityBridgeManager = options.startEntityBridgeManager ?? true
    this.rehydrateTenantOnStart = options.rehydrateTenantOnStart ?? true
    this.entityProjector =
      options.entityProjector ??
      new EntityProjector({
        db: this.db,
        electricUrl: this.electricUrl,
        electricSecret: this.electricSecret,
        streamClientForTenant: (tenantId) =>
          this.requireTenantForSharedProcess(tenantId, `entity-projector`)
            .streamClient,
        tenantIds: () => this.registeredTenantIds(),
      })

    this.scheduler = new Scheduler({
      pgClient: this.pgClient,
      instanceId: `${this.instanceId}:scheduler`,
      tenantId: null,
      tenantIds: () => this.registeredTenantIds(),
      executors: {
        delayed_send: async (payload, taskId, tenantId) => {
          const runtime = this.requireTenantForSharedProcess(
            tenantId,
            `scheduler delayed_send`
          )
          await runtime.executeDelayedSend(payload, taskId)
        },
        cron_tick: async (payload, tickNumber, _taskId, tenantId) => {
          const runtime = this.requireTenantForSharedProcess(
            tenantId,
            `scheduler cron_tick`
          )
          await runtime.executeCronTick(payload, tickNumber)
        },
      },
    })

    this.tagStreamOutboxDrainer = new TagStreamOutboxDrainer(
      new PostgresRegistry(this.db, DEFAULT_TENANT_ID),
      (tenantId) =>
        this.requireTenantForSharedProcess(tenantId, `tag-outbox`).streamClient,
      { tenantId: null, tenantIds: () => this.registeredTenantIds() }
    )
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    try {
      if (this.electricUrl) {
        await this.wakeRegistry.startSync(this.electricUrl, this.electricSecret)
      } else {
        await this.wakeRegistry.loadRegistrations()
      }
      if (this.startEntityBridgeManager) {
        await this.entityProjector.start()
      }
      await this.startRegisteredTenants()
      this.tagStreamOutboxDrainer.start()
      await this.scheduler.start()
    } catch (error) {
      await this.stop().catch(() => {})
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return
    this.running = false

    await this.scheduler.stop()
    await this.tagStreamOutboxDrainer.stop()

    const runtimes = await Promise.allSettled(this.tenantRegistrations.values())
    await Promise.allSettled(
      runtimes
        .filter(
          (result): result is PromiseFulfilledResult<AgentsHostTenantRuntime> =>
            result.status === `fulfilled`
        )
        .map((result) => result.value.stop())
    )
    this.tenantRegistrations.clear()
    this.tenantRuntimes.clear()

    if (this.ownsWakeRegistry) {
      await this.wakeRegistry.stopSync()
    }
    if (this.ownsEntityProjector) {
      await this.entityProjector.stop()
    }
  }

  async registerTenant(
    config: AgentsHostTenantConfig
  ): Promise<AgentsHostTenantRuntime> {
    const serviceId = config.serviceId
    return await this.withTenantOperation(serviceId, async () => {
      const runtime = this.tenantRuntimes.get(serviceId)
      if (runtime) return runtime

      const existing = this.tenantRegistrations.get(serviceId)
      if (existing) return existing

      const runtimePromise = this.createTenantRuntime(config)
      this.tenantRegistrations.set(serviceId, runtimePromise)

      try {
        const registeredRuntime = await runtimePromise
        this.tenantRuntimes.set(serviceId, registeredRuntime)
        if (this.running) {
          await this.startTenantRuntime(registeredRuntime)
          this.scheduler.wake()
        }
        return registeredRuntime
      } catch (error) {
        if (this.tenantRegistrations.get(serviceId) === runtimePromise) {
          this.tenantRegistrations.delete(serviceId)
        }
        if (this.tenantRuntimes.get(serviceId)) {
          this.tenantRuntimes.delete(serviceId)
        }
        throw error
      }
    })
  }

  getTenant(
    serviceId = DEFAULT_TENANT_ID
  ): AgentsHostTenantRuntime | undefined {
    return this.tenantRuntimes.get(serviceId)
  }

  requireTenant(serviceId = DEFAULT_TENANT_ID): AgentsHostTenantRuntime {
    const runtime = this.getTenant(serviceId)
    if (!runtime) {
      throw new Error(`AgentsHost tenant "${serviceId}" is not registered`)
    }
    return runtime
  }

  async unregisterTenant(serviceId = DEFAULT_TENANT_ID): Promise<void> {
    await this.withTenantOperation(serviceId, async () => {
      const registration = this.tenantRegistrations.get(serviceId)
      const runtime = this.tenantRuntimes.get(serviceId)

      this.tenantRegistrations.delete(serviceId)
      this.tenantRuntimes.delete(serviceId)

      const resolvedRuntime =
        runtime ??
        (registration ? await registration.catch(() => undefined) : undefined)
      if (!resolvedRuntime) return

      await resolvedRuntime.stop()
      if (this.running) {
        this.scheduler.wake()
      }
    })
  }

  private async withTenantOperation<T>(
    serviceId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previous = this.tenantOperations.get(serviceId) ?? Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    const current = result.then(
      () => undefined,
      () => undefined
    )
    this.tenantOperations.set(serviceId, current)

    try {
      return await result
    } finally {
      if (this.tenantOperations.get(serviceId) === current) {
        this.tenantOperations.delete(serviceId)
      }
    }
  }

  private registeredTenantIds(): Array<string> {
    return [...this.tenantRuntimes.keys()]
  }

  private requireTenantForSharedProcess(
    serviceId: string,
    processName: string
  ): AgentsHostTenantRuntime {
    const runtime = this.getTenant(serviceId)
    if (!runtime) {
      throw new UnregisteredTenantError(serviceId, processName)
    }
    return runtime
  }

  private async startRegisteredTenants(): Promise<void> {
    const runtimes = await Promise.all(this.tenantRegistrations.values())
    for (const runtime of runtimes) {
      await this.startTenantRuntime(runtime)
    }
  }

  private async startTenantRuntime(
    runtime: AgentsHostTenantRuntime
  ): Promise<void> {
    await runtime.manager.ensurePrincipalEntityType()

    if (this.rehydrateTenantOnStart) {
      await runtime.rehydrateCronSchedules()
    }
    if (this.startEntityBridgeManager) {
      await this.entityProjector.loadTenantBridges(
        runtime.serviceId,
        runtime.registry
      )
    }
  }

  private async createTenantRuntime(
    config: AgentsHostTenantConfig
  ): Promise<AgentsHostTenantRuntime> {
    const serviceId = config.serviceId
    const streamClient = this.createStreamClient(config)
    const registry = new PostgresRegistry(this.db, serviceId)
    const scheduler = new PostgresSchedulerClient(
      this.pgClient,
      serviceId,
      () => this.scheduler.wake()
    )
    const runtime = new ElectricAgentsTenantRuntime({
      service: serviceId,
      db: this.db,
      registry,
      streamClient,
      wakeRegistry: this.wakeRegistry,
      scheduler,
      entityBridgeManager: this.entityProjector.forTenant(serviceId, registry),
    })

    await runtime.manager.ensurePrincipalEntityType()

    return runtime
  }

  private createStreamClient(config: AgentsHostTenantConfig): StreamClient {
    if (config.streamClient) return config.streamClient
    if (config.durableStreamsUrl) {
      return new StreamClient(config.durableStreamsUrl, {
        bearer: config.durableStreamsBearer,
        ...(config.durableStreamsRouting
          ? {
              subscriptionRouting: {
                serviceId: config.serviceId,
                adapter: config.durableStreamsRouting,
              },
            }
          : {}),
      })
    }
    throw new Error(
      `AgentsHost tenant "${config.serviceId}" must provide a streamClient or durableStreamsUrl`
    )
  }
}

export { AgentsHost as ElectricAgentsHost }
