import { randomUUID } from 'node:crypto'
import { PostgresRegistry } from './entity-registry.js'
import { EntityBridgeManager } from './entity-bridge-manager.js'
import { serverLog } from './utils/log.js'
import { ElectricAgentsTenantRuntime } from './runtime.js'
import { Scheduler } from './scheduler.js'
import { StreamClient, durableStreamsServiceUrl } from './stream-client.js'
import { TagStreamOutboxDrainer } from './tag-stream-outbox-drainer.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import { WakeRegistry } from './wake-registry.js'
import type { DrizzleDB, PgClient } from './db/index.js'
import type { EntityManager } from './entity-manager.js'
import type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
import type { CronTickPayload, DelayedSendPayload } from './scheduler.js'
import type { DurableStreamsBearerProvider } from './stream-client.js'

export interface StandaloneAgentsRuntimeOptions {
  service?: string
  tenantId?: string
  db: DrizzleDB
  pgClient: PgClient
  durableStreamsUrl?: string
  durableStreamsBearer?: DurableStreamsBearerProvider
  streamClient?: StreamClient
  electricUrl?: string
  electricSecret?: string
  instanceId?: string
  wakeRegistry?: WakeRegistry
  startWakeRegistry?: boolean
  startScheduler?: boolean
  startTagStreamOutboxDrainer?: boolean
  startEntityBridgeManager?: boolean
  rehydrateOnStart?: boolean
  entityBridgeManager?: EntityBridgeCoordinator
}

export interface StartedStandaloneAgentsRuntime {
  serviceId: string
  service: string
  db: DrizzleDB
  pgClient: PgClient
  streamClient: StreamClient
  registry: PostgresRegistry
  wakeRegistry: WakeRegistry
  runtime: ElectricAgentsTenantRuntime
  manager: EntityManager
  scheduler: Scheduler
  entityBridgeManager: EntityBridgeCoordinator
  tagStreamOutboxDrainer: TagStreamOutboxDrainer
  stop: () => Promise<void>
}

export async function startStandaloneAgentsRuntime(
  options: StandaloneAgentsRuntimeOptions
): Promise<StartedStandaloneAgentsRuntime> {
  const serviceId = options.service ?? options.tenantId ?? DEFAULT_TENANT_ID
  const streamClient =
    options.streamClient ??
    (options.durableStreamsUrl
      ? new StreamClient(
          durableStreamsServiceUrl(options.durableStreamsUrl, serviceId),
          { bearer: options.durableStreamsBearer }
        )
      : undefined)
  if (!streamClient) {
    throw new Error(`Either durableStreamsUrl or streamClient is required`)
  }

  const registry = new PostgresRegistry(options.db, serviceId)
  const wakeRegistry =
    options.wakeRegistry ?? new WakeRegistry(options.db, serviceId)
  let runtime: ElectricAgentsTenantRuntime
  const scheduler = new Scheduler({
    pgClient: options.pgClient,
    instanceId: options.instanceId ?? randomUUID(),
    tenantId: serviceId,
    executors: {
      delayed_send: async (payload: DelayedSendPayload, taskId: number) => {
        await runtime.executeDelayedSend(payload, taskId)
      },
      cron_tick: async (payload: CronTickPayload, tickNumber: number) => {
        await runtime.executeCronTick(payload, tickNumber)
      },
    },
  })
  const entityBridgeManager =
    options.entityBridgeManager ??
    new EntityBridgeManager(
      registry,
      streamClient,
      options.electricUrl,
      options.electricSecret,
      serviceId
    )
  const tagStreamOutboxDrainer = new TagStreamOutboxDrainer(
    registry,
    streamClient
  )

  runtime = new ElectricAgentsTenantRuntime({
    service: serviceId,
    db: options.db,
    registry,
    streamClient,
    wakeRegistry,
    scheduler,
    entityBridgeManager,
    stopWakeRegistryOnShutdown: options.wakeRegistry ? false : true,
  })

  const startWakeRegistry = options.startWakeRegistry ?? true
  const startScheduler = options.startScheduler ?? true
  const startTagStreamOutboxDrainer =
    options.startTagStreamOutboxDrainer ?? true
  const startEntityBridgeManager = options.startEntityBridgeManager ?? true
  const rehydrateOnStart = options.rehydrateOnStart ?? true
  let entityBridgeManagerStarted = false
  let tagStreamOutboxDrainerStarted = false
  let schedulerStarted = false
  let stopped = false

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    if (schedulerStarted) {
      await scheduler.stop()
      schedulerStarted = false
    }
    if (tagStreamOutboxDrainerStarted) {
      await tagStreamOutboxDrainer.stop()
      tagStreamOutboxDrainerStarted = false
    }
    if (entityBridgeManagerStarted) {
      await entityBridgeManager.stop()
      entityBridgeManagerStarted = false
    }
    await runtime.stop()
  }

  try {
    if (startWakeRegistry) {
      serverLog.info(`[agent-server] rebuilding wake registry...`)
      await runtime.manager.rebuildWakeRegistry(
        options.electricUrl,
        options.electricSecret
      )
    }
    if (rehydrateOnStart) {
      serverLog.info(`[agent-server] rehydrating cron schedules...`)
      await runtime.rehydrateCronSchedules()
    }
    if (startEntityBridgeManager) {
      serverLog.info(`[agent-server] starting entity bridge manager...`)
      await entityBridgeManager.start()
      entityBridgeManagerStarted = true
    }
    if (startTagStreamOutboxDrainer) {
      serverLog.info(`[agent-server] starting tag stream outbox drainer...`)
      tagStreamOutboxDrainer.start()
      tagStreamOutboxDrainerStarted = true
    }
    if (startScheduler) {
      serverLog.info(`[agent-server] starting scheduler...`)
      schedulerStarted = true
      await scheduler.start()
      serverLog.info(`[agent-server] scheduler started`)
    }
  } catch (error) {
    await stop().catch(() => {})
    throw error
  }

  return {
    serviceId,
    service: serviceId,
    db: options.db,
    pgClient: options.pgClient,
    streamClient,
    registry,
    wakeRegistry,
    runtime,
    manager: runtime.manager,
    scheduler,
    entityBridgeManager,
    tagStreamOutboxDrainer,
    stop,
  }
}
