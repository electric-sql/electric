import { parseCronStreamPath } from '@electric-ax/agents-runtime'
import { and, eq } from 'drizzle-orm'
import { consumerCallbacks, wakeRegistrations } from './db/schema.js'
import { ClaimWriteTokenStore } from './claim-write-token-store.js'
import { PostgresRegistry } from './entity-registry.js'
import { EntityManager } from './entity-manager.js'
import {
  buildManifestWakeRegistration,
  extractManifestCronSpec,
} from './manifest-side-effects.js'
import { SchemaValidator } from './electric-agents/schema-validator.js'
import { serverLog } from './utils/log.js'
import { isPermanentElectricAgentsError } from './scheduler.js'
import { StreamClient } from './stream-client.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import type { DrizzleDB } from './db/index.js'
import type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
import type { DurableStreamsBearerProvider } from './stream-client.js'
import type {
  CronTickPayload,
  DelayedSendPayload,
  SchedulerClient,
} from './scheduler.js'
import type { WakeRegistry } from './wake-registry.js'

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T
}

export interface ElectricAgentsTenantRuntimeOptions {
  service?: string
  tenantId?: string
  db: DrizzleDB
  registry?: PostgresRegistry
  durableStreamsUrl?: string
  durableStreamsBearer?: DurableStreamsBearerProvider
  streamClient?: StreamClient
  wakeRegistry: WakeRegistry
  scheduler: SchedulerClient
  entityBridgeManager: EntityBridgeCoordinator
  claimWriteTokens?: ClaimWriteTokenStore
  stopWakeRegistryOnShutdown?: boolean
}

export class ElectricAgentsTenantRuntime {
  readonly serviceId: string
  readonly service: string
  readonly db: DrizzleDB
  readonly streamClient: StreamClient
  readonly registry: PostgresRegistry
  readonly wakeRegistry: WakeRegistry
  readonly scheduler: SchedulerClient
  readonly entityBridgeManager: EntityBridgeCoordinator
  readonly claimWriteTokens: ClaimWriteTokenStore
  readonly manager: EntityManager

  constructor(options: ElectricAgentsTenantRuntimeOptions) {
    this.serviceId = options.service ?? options.tenantId ?? DEFAULT_TENANT_ID
    this.service = this.serviceId
    this.db = options.db
    if (options.streamClient) {
      this.streamClient = options.streamClient
    } else if (options.durableStreamsUrl) {
      this.streamClient = new StreamClient(options.durableStreamsUrl, {
        bearer: options.durableStreamsBearer,
      })
    } else {
      throw new Error(`Either durableStreamsUrl or streamClient is required`)
    }

    this.registry =
      options.registry ?? new PostgresRegistry(this.db, this.serviceId)
    this.wakeRegistry = options.wakeRegistry
    this.scheduler = options.scheduler
    this.entityBridgeManager = options.entityBridgeManager
    this.claimWriteTokens =
      options.claimWriteTokens ?? new ClaimWriteTokenStore()
    this.manager = new EntityManager({
      registry: this.registry,
      streamClient: this.streamClient,
      validator: new SchemaValidator(),
      wakeRegistry: this.wakeRegistry,
      scheduler: this.scheduler,
      entityBridgeManager: this.entityBridgeManager,
      writeTokenValidator: (entity, token) =>
        this.claimWriteTokens.isValid(
          this.serviceId,
          entity.streams.main,
          token
        ),
      stopWakeRegistryOnShutdown: options.stopWakeRegistryOnShutdown ?? false,
    })
  }

  async stop(): Promise<void> {
    await this.manager.shutdown()
  }

  async rehydrateCronSchedules(): Promise<void> {
    const rows = await this.db
      .select({ sourceUrl: wakeRegistrations.sourceUrl })
      .from(wakeRegistrations)
      .where(eq(wakeRegistrations.tenantId, this.serviceId))
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
        await this.manager.getOrCreateCronStream(spec.expression, spec.timezone)
      } catch (err) {
        serverLog.warn(`[agent-server] cron rehydration failed:`, err)
      }
    }

    const { entities } = await this.manager.registry.listEntities({
      limit: 10_000,
    })
    await this.manager.registry.clearEntityManifestSources()

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

  async evaluateWakePayload(
    sourceUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
    if (Array.isArray(event)) {
      await Promise.all(
        event.map((item) => this.manager.evaluateWakes(sourceUrl, item))
      )
      return
    }

    await this.manager.evaluateWakes(sourceUrl, event)
  }

  checkRunFinished(
    sourceUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): void {
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

  async syncManifestWakes(
    subscriberUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
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
        await this.manager.wakeRegistry.unregisterByManifestKey(
          subscriberUrl,
          manifestKey,
          this.serviceId
        )
        continue
      }

      await this.manager.wakeRegistry.unregisterByManifestKey(
        subscriberUrl,
        manifestKey,
        this.serviceId
      )

      if (value) {
        const reg = buildManifestWakeRegistration(
          subscriberUrl,
          value,
          manifestKey
        )
        if (reg) {
          reg.tenantId = this.serviceId
          await this.manager.wakeRegistry.register(reg)
        }

        const cronSpec = extractManifestCronSpec(value)
        if (cronSpec) {
          void this.manager
            .getOrCreateCronStream(cronSpec.expression, cronSpec.timezone)
            .catch((err) =>
              serverLog.warn(`[agent-server] cron schedule failed:`, err)
            )
        }
      }
    }
  }

  async syncManifestEntitySources(
    ownerEntityUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
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

  async syncManifestSchedules(
    ownerEntityUrl: string,
    event: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<void> {
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

  async executeDelayedSend(
    payload: DelayedSendPayload,
    taskId: number
  ): Promise<void> {
    const producerId = payload.producerId ?? `scheduler-task-${taskId}`
    try {
      await this.manager.send(
        payload.entityUrl,
        {
          from: payload.from,
          from_principal: payload.from_principal,
          from_agent: payload.from_agent,
          payload: payload.payload,
          key: payload.key ?? `scheduled-task-${taskId}`,
          type: payload.type,
        },
        {
          producerId,
        }
      )

      if (payload.manifest) {
        await this.manager.writeManifestEntry(
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
        await this.manager.writeManifestEntry(
          payload.manifest.ownerEntityUrl,
          payload.manifest.key,
          `update`,
          omitUndefined({
            ...payload.manifest.entry,
            status: `failed`,
            failedAt: new Date().toISOString(),
            sentAt: undefined,
            lastError: err instanceof Error ? err.message : String(err),
          }),
          {
            producerId: `manifest-status-${producerId}-failed`,
          }
        )
      }
      throw err
    }
  }

  async executeCronTick(
    payload: CronTickPayload,
    tickNumber: number
  ): Promise<void> {
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
    await this.manager.evaluateWakes(streamPath, tickEvent)
  }

  private async applyManifestFutureSendSchedule(
    ownerEntityUrl: string,
    manifestKey: string,
    operation: string | undefined,
    value: Record<string, unknown> | undefined
  ): Promise<void> {
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
    const senderUrl =
      typeof value.senderUrl === `string` ? value.senderUrl : ownerEntityUrl
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
        from: senderUrl,
        from_agent: senderUrl,
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
            senderUrl,
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
    const sourceRef =
      operation === `delete` ? undefined : this.extractEntitiesSourceRef(value)
    await this.manager.registry.replaceEntityManifestSource(
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

  private async maybeMarkEntityIdleAfterRunFinished(
    entityUrl: string
  ): Promise<void> {
    const primaryStream = `${entityUrl}/main`
    const callbacks = await this.db
      .select()
      .from(consumerCallbacks)
      .where(
        and(
          eq(consumerCallbacks.tenantId, this.serviceId),
          eq(consumerCallbacks.primaryStream, primaryStream)
        )
      )
      .limit(1)

    if (callbacks.length > 0) {
      return
    }

    const entity = await this.manager.registry.getEntity(entityUrl)
    await this.manager.registry.updateStatus(
      entityUrl,
      entity?.status === `stopping` ? `stopped` : `idle`
    )
    await this.entityBridgeManager.onEntityChanged(entityUrl)
  }
}
