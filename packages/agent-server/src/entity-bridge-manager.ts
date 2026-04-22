import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import {
  assertTags,
  buildTagsIndex,
  getEntitiesStreamPath,
  normalizeTags,
  sourceRefForTags,
} from '@electric-ax/agent-runtime'
import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
import { serverLog } from './log.js'
import type {
  EntityBridgeRow,
  PostgresRegistry,
} from './electric-agents-registry.js'
import type { StreamClient } from './stream-client.js'
import type {
  ChangeMessage,
  Offset,
  Row,
  ShapeStreamInterface,
} from '@electric-sql/client'
import type {
  EntityMembershipRow,
  EntityTags,
} from '@electric-ax/agent-runtime'

interface EntityShapeRow extends Row<unknown> {
  url: string
  type: string
  status: `spawning` | `running` | `idle` | `stopped`
  tags: EntityTags
  spawn_args?: Record<string, unknown> | null
  parent?: string | null
  type_revision?: number | null
  inbox_schemas?: Record<string, Record<string, unknown>> | null
  state_schemas?: Record<string, Record<string, unknown>> | null
  created_at: number
  updated_at: number
}

const ENTITY_SHAPE_COLUMNS = [
  `url`,
  `type`,
  `status`,
  `tags`,
  `spawn_args`,
  `parent`,
  `type_revision`,
  `inbox_schemas`,
  `state_schemas`,
  `created_at`,
  `updated_at`,
] as const

function parseElectricOffset(offset: string): Offset | null {
  if (offset === `-1` || offset === `now`) {
    return offset
  }
  return /^\d+_\d+$/.test(offset) ? (offset as Offset) : null
}

function sameMember(
  left: EntityMembershipRow | undefined,
  right: EntityMembershipRow
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function toMemberRow(entity: EntityShapeRow): EntityMembershipRow {
  return {
    url: entity.url,
    type: entity.type,
    status: entity.status,
    tags: entity.tags,
    spawn_args: entity.spawn_args ?? {},
    parent: entity.parent ?? null,
    type_revision: entity.type_revision ?? null,
    inbox_schemas: entity.inbox_schemas ?? null,
    state_schemas: entity.state_schemas ?? null,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

function buildTagsWhereClause(tags: EntityTags): string {
  const encoded = buildTagsIndex(tags).map(
    (entry) => `'${entry.replace(/'/g, `''`)}'`
  )
  if (encoded.length === 0) {
    return `TRUE`
  }
  return `tags_index @> ARRAY[${encoded.join(`, `)}]::text[]`
}

class EntityBridge {
  readonly sourceRef: string
  readonly tags: EntityTags
  readonly streamUrl: string

  private currentMembers = new Map<string, EntityMembershipRow>()
  private producer: IdempotentProducer | null = null
  private liveAbortController: AbortController | null = null
  private liveUnsubscribe: (() => void) | null = null
  private stopped = false
  private resyncPromise: Promise<void> | null = null
  private bootstrapState: {
    staleMembers: Map<string, EntityMembershipRow>
    resolve: (result: `up-to-date` | `must-refetch`) => void
    reject: (error: Error) => void
  } | null = null

  constructor(
    row: EntityBridgeRow,
    private registry: PostgresRegistry,
    private streamClient: StreamClient,
    private electricUrl: string
  ) {
    this.sourceRef = row.sourceRef
    this.tags = normalizeTags(row.tags)
    this.streamUrl = row.streamUrl
    this.initialShapeHandle = row.shapeHandle
    this.initialShapeOffset = row.shapeOffset
  }

  private initialShapeHandle?: string
  private initialShapeOffset?: string

  async start(): Promise<void> {
    await this.ensureStream()
    this.producer = new IdempotentProducer(
      new DurableStream({
        url: `${this.streamClient.baseUrl}${this.streamUrl}`,
        contentType: `application/json`,
      }),
      `entity-bridge-${this.sourceRef}`,
      {
        autoClaim: true,
        onError: (error) => {
          serverLog.warn(
            `[entity-bridge] producer write failed for ${this.sourceRef}:`,
            error
          )
        },
      }
    )
    await this.loadCurrentMembers()
    if (this.initialShapeHandle && this.initialShapeOffset) {
      const initialOffset = parseElectricOffset(this.initialShapeOffset)
      if (initialOffset) {
        this.startLiveStream(initialOffset, this.initialShapeHandle)
        return
      }
    }
    await this.resync(`startup`)
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.stopLiveStream()
    this.clearBootstrapState()?.resolve(`up-to-date`)
    if (this.producer) {
      try {
        await this.producer.flush()
      } catch {
        // Reconcile repairs missed writes on next startup.
      }
      await this.producer.detach()
      this.producer = null
    }
  }

  async requestResync(reason: string): Promise<void> {
    if (this.stopped) return
    if (this.resyncPromise) {
      await this.resyncPromise
      return
    }

    this.resyncPromise = this.resync(reason).finally(() => {
      this.resyncPromise = null
    })
    await this.resyncPromise
  }

  private async resync(reason: string): Promise<void> {
    if (this.stopped) return

    serverLog.info(
      `[entity-bridge] resyncing ${this.sourceRef} from shape log bootstrap (${reason})`
    )

    this.stopLiveStream()

    if (this.producer) {
      try {
        await this.producer.flush()
      } catch {
        // A later reconcile will repair any dropped writes.
      }
    }

    for (;;) {
      await this.loadCurrentMembers()
      const result = await this.startBootstrapStream()
      if (result === `up-to-date`) {
        return
      }
    }
  }

  private async ensureStream(): Promise<void> {
    if (!(await this.streamClient.exists(this.streamUrl))) {
      await this.streamClient.create(this.streamUrl, {
        contentType: `application/json`,
      })
    }
  }

  private startBootstrapStream(): Promise<`up-to-date` | `must-refetch`> {
    return new Promise((resolve, reject) => {
      this.bootstrapState = {
        staleMembers: new Map(this.currentMembers),
        resolve,
        reject,
      }
      this.startLiveStream(`-1`)
    })
  }

  private finalizeBootstrap(): void {
    if (!this.bootstrapState) {
      return
    }

    for (const [url, existing] of this.bootstrapState.staleMembers) {
      this.append(`delete`, existing)
      this.currentMembers.delete(url)
    }
  }

  private clearBootstrapState(): {
    staleMembers: Map<string, EntityMembershipRow>
    resolve: (result: `up-to-date` | `must-refetch`) => void
    reject: (error: Error) => void
  } | null {
    const state = this.bootstrapState
    this.bootstrapState = null
    return state
  }

  private async loadCurrentMembers(): Promise<void> {
    this.currentMembers.clear()
    const events = await this.streamClient.readJson<Record<string, unknown>>(
      this.streamUrl
    )
    for (const event of events) {
      if (event.type !== `members` || typeof event.key !== `string`) {
        continue
      }
      const headers =
        typeof event.headers === `object` && event.headers !== null
          ? (event.headers as Record<string, unknown>)
          : undefined
      const operation = headers?.operation
      if (operation === `delete`) {
        this.currentMembers.delete(event.key)
        continue
      }
      const value = event.value as EntityMembershipRow | undefined
      if (value) {
        this.currentMembers.set(event.key, value)
      }
    }
  }

  private createShapeStream(opts?: {
    offset?: Offset
    handle?: string
    signal?: AbortSignal
  }): ShapeStreamInterface<EntityShapeRow> {
    return new ShapeStream<EntityShapeRow>({
      url: new URL(`/v1/shape`, this.electricUrl).toString(),
      params: {
        table: `entities`,
        where: buildTagsWhereClause(this.tags),
        columns: [...ENTITY_SHAPE_COLUMNS],
        replica: `full`,
      },
      parser: {
        int8: (value: string) => Number.parseInt(value, 10),
      },
      ...(opts?.offset ? { offset: opts.offset } : {}),
      ...(opts?.handle ? { handle: opts.handle } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
      onError: (error) => {
        if (opts?.signal?.aborted) {
          return {}
        }
        serverLog.warn(
          `[entity-bridge] live shape error for ${this.sourceRef}:`,
          error
        )
        return {}
      },
    })
  }

  private startLiveStream(offset: Offset, handle?: string): void {
    if (this.stopped) return

    const abortController = new AbortController()
    const stream = this.createShapeStream({
      offset,
      handle,
      signal: abortController.signal,
    })

    this.liveAbortController = abortController
    this.liveUnsubscribe = stream.subscribe(
      async (messages) => {
        let shouldPersistCursor = false
        let bootstrapResult: `up-to-date` | `must-refetch` | null = null
        for (const message of messages) {
          if (isControlMessage(message)) {
            if (message.headers.control === `must-refetch`) {
              await this.registry.clearEntityBridgeCursor(this.sourceRef)
              const bootstrapState = this.clearBootstrapState()
              if (bootstrapState) {
                this.stopLiveStream()
                bootstrapResult = `must-refetch`
                bootstrapState.resolve(`must-refetch`)
                return
              }
              await this.requestResync(`shape-reset`)
              return
            }
            if (
              message.headers.control === `up-to-date` &&
              this.bootstrapState
            ) {
              this.finalizeBootstrap()
              bootstrapResult = `up-to-date`
            }
            shouldPersistCursor = true
            continue
          }

          if (!isChangeMessage(message)) {
            continue
          }

          this.bootstrapState?.staleMembers.delete(message.key)
          this.applyChange(message)
          shouldPersistCursor = true
        }

        if (shouldPersistCursor) {
          await this.persistCursor(stream)
        }

        if (bootstrapResult === `up-to-date`) {
          const bootstrapState = this.clearBootstrapState()
          bootstrapState?.resolve(`up-to-date`)
        }
      },
      (error) => {
        const bootstrapState = this.clearBootstrapState()
        if (bootstrapState) {
          bootstrapState.reject(
            error instanceof Error ? error : new Error(String(error))
          )
        }
        if (abortController.signal.aborted) {
          return
        }
        serverLog.warn(
          `[entity-bridge] live subscription failed for ${this.sourceRef}:`,
          error
        )
        void this.requestResync(`subscription-error`)
      }
    )
  }

  private async persistCursor(
    stream: ShapeStreamInterface<EntityShapeRow>
  ): Promise<void> {
    const shapeHandle = stream.shapeHandle
    const shapeOffset = stream.lastOffset
    if (!shapeHandle || shapeOffset === `-1`) {
      return
    }
    await this.registry.updateEntityBridgeCursor(
      this.sourceRef,
      shapeHandle,
      shapeOffset
    )
  }

  private stopLiveStream(): void {
    this.liveUnsubscribe?.()
    this.liveUnsubscribe = null
    this.liveAbortController?.abort()
    this.liveAbortController = null
  }

  private applyChange(message: ChangeMessage<EntityShapeRow>): void {
    const next = toMemberRow(message.value)
    const existing = this.currentMembers.get(message.key)
    const operation = message.headers.operation

    if (operation === `delete`) {
      if (!existing) return
      this.append(`delete`, existing)
      this.currentMembers.delete(message.key)
      return
    }

    if (!existing) {
      this.append(`insert`, next)
      this.currentMembers.set(message.key, next)
      return
    }

    if (!sameMember(existing, next)) {
      this.append(`update`, next)
      this.currentMembers.set(message.key, next)
    }
  }

  private append(
    operation: `insert` | `update` | `delete`,
    row: EntityMembershipRow
  ): void {
    if (!this.producer) {
      throw new Error(
        `[entity-bridge] producer is not initialized for ${this.sourceRef}`
      )
    }

    const event =
      operation === `delete`
        ? {
            type: `members`,
            key: row.url,
            old_value: row,
            headers: {
              operation,
              timestamp: new Date().toISOString(),
            },
          }
        : {
            type: `members`,
            key: row.url,
            value: row,
            headers: {
              operation,
              timestamp: new Date().toISOString(),
            },
          }

    this.producer.append(JSON.stringify(event))
  }
}

export class EntityBridgeManager {
  private bridges = new Map<string, EntityBridge>()
  private startingBridges = new Map<string, Promise<void>>()
  private activeReaders = new Map<string, number>()
  private gcTimer: NodeJS.Timeout | null = null

  constructor(
    private registry: PostgresRegistry,
    private streamClient: StreamClient,
    private electricUrl?: string
  ) {}

  async start(): Promise<void> {
    if (
      !this.electricUrl ||
      typeof this.registry.listEntityBridges !== `function`
    ) {
      return
    }

    const rows = await this.registry.listEntityBridges()
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.ensureBridge(row)
        } catch (error) {
          serverLog.warn(
            `[entity-bridge] failed to start ${row.sourceRef}:`,
            error
          )
        }
      })
    )

    // 5-minute sweep / 15-minute idle TTL (see sweepIdleBridges). The idle
    // grace absorbs client flapping (reloads, brief disconnects) without
    // triggering a full reconcile on each reconnect; the sweep cadence is
    // fast enough to release bridges soon after observers go away.
    this.gcTimer = setInterval(() => {
      void this.sweepIdleBridges().catch((error) => {
        serverLog.warn(`[entity-bridge] idle sweep failed:`, error)
      })
    }, 5 * 60_000)
  }

  async stop(): Promise<void> {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }

    const bridges = [...this.bridges.values()]
    this.bridges.clear()
    this.startingBridges.clear()
    this.activeReaders.clear()

    await Promise.all(
      bridges.map(async (bridge) => {
        await bridge.stop()
      })
    )
  }

  async register(tagsInput: unknown): Promise<{
    sourceRef: string
    streamUrl: string
  }> {
    if (!this.electricUrl) {
      throw new Error(`[entity-bridge] Electric URL is required for entities()`)
    }

    const tags = normalizeTags(assertTags(tagsInput))
    const sourceRef = sourceRefForTags(tags)
    const streamUrl = getEntitiesStreamPath(sourceRef)

    const row = await this.registry.upsertEntityBridge({
      sourceRef,
      tags,
      streamUrl,
    })
    await this.registry.touchEntityBridge(sourceRef)
    await this.ensureBridge(row)

    return { sourceRef, streamUrl }
  }

  async onEntityChanged(_entityUrl: string): Promise<void> {
    // Membership updates come from the Electric shape. This hook remains only
    // to preserve existing call sites until they are cleaned up.
  }

  async touchByStreamPath(streamPath: string): Promise<void> {
    const sourceRef = this.sourceRefFromStreamPath(streamPath)
    if (!sourceRef) return
    await this.touchSourceRef(sourceRef, `head`)
  }

  async beginClientRead(
    streamPath: string
  ): Promise<(() => Promise<void>) | null> {
    const sourceRef = this.sourceRefFromStreamPath(streamPath)
    if (!sourceRef) return null

    const current = this.activeReaders.get(sourceRef) ?? 0
    this.activeReaders.set(sourceRef, current + 1)
    await this.touchSourceRef(sourceRef, `read-open`)

    return async () => {
      const remaining = (this.activeReaders.get(sourceRef) ?? 1) - 1
      if (remaining <= 0) {
        this.activeReaders.delete(sourceRef)
      } else {
        this.activeReaders.set(sourceRef, remaining)
      }
      await this.touchSourceRef(sourceRef, `read-close`)
    }
  }

  private async ensureBridge(row: EntityBridgeRow): Promise<void> {
    if (this.bridges.has(row.sourceRef)) return
    const starting = this.startingBridges.get(row.sourceRef)
    if (starting) {
      await starting
      return
    }
    if (!this.electricUrl) {
      throw new Error(`[entity-bridge] Electric URL is required for entities()`)
    }

    const startPromise = (async () => {
      const bridge = new EntityBridge(
        row,
        this.registry,
        this.streamClient,
        this.electricUrl!
      )
      await bridge.start()
      this.bridges.set(row.sourceRef, bridge)
    })().finally(() => {
      this.startingBridges.delete(row.sourceRef)
    })

    this.startingBridges.set(row.sourceRef, startPromise)
    await startPromise
  }

  private async sweepIdleBridges(): Promise<void> {
    const activeSourceRefs = await this.collectReferencedSourceRefs()
    for (const sourceRef of activeSourceRefs) {
      await this.registry.touchEntityBridge(sourceRef)
    }

    const stale = await this.registry.listStaleEntityBridges(
      new Date(Date.now() - 15 * 60_000)
    )

    for (const row of stale) {
      if (activeSourceRefs.has(row.sourceRef)) continue
      if ((this.activeReaders.get(row.sourceRef) ?? 0) > 0) continue
      const bridge = this.bridges.get(row.sourceRef)
      this.bridges.delete(row.sourceRef)
      await bridge?.stop()
      await this.registry.deleteEntityBridge(row.sourceRef)
    }
  }

  private async collectReferencedSourceRefs(): Promise<Set<string>> {
    return new Set(await this.registry.listReferencedEntitySourceRefs())
  }

  private sourceRefFromStreamPath(streamPath: string): string | null {
    const match = streamPath.match(/^\/_entities\/([^/]+)$/)
    return match?.[1] ?? null
  }

  private async touchSourceRef(
    sourceRef: string,
    reason: string
  ): Promise<void> {
    try {
      await this.registry.touchEntityBridge(sourceRef)
    } catch (error) {
      serverLog.warn(
        `[entity-bridge] failed to touch ${sourceRef} during ${reason}:`,
        error
      )
    }
  }
}
