import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import {
  assertTags,
  buildTagsIndex,
  getEntitiesStreamPath,
  hashString,
  normalizeTags,
  sourceRefForTags,
} from '@electric-ax/agents-runtime'
import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
import { PostgresRegistry } from './entity-registry.js'
import { electricUrlWithPath } from './utils/electric-url.js'
import { serverLog } from './utils/log.js'
import { isUnregisteredTenantError } from './tenant.js'
import { isBuiltInSystemPrincipalUrl } from './principal.js'
import type { DrizzleDB } from './db/index.js'
import type { EntityBridgeCoordinator } from './entity-bridge-manager.js'
import type { EntityBridgeRow } from './entity-registry.js'
import type { StreamClient } from './stream-client.js'
import type {
  ChangeMessage,
  Message,
  Offset,
  Row,
  ShapeStreamInterface,
} from '@electric-sql/client'
import type {
  EntityMembershipRow,
  EntityTags,
} from '@electric-ax/agents-runtime'

interface EntityShapeRow extends Row<unknown> {
  tenant_id: string
  url: string
  type: string
  status: `spawning` | `running` | `idle` | `stopped`
  tags: EntityTags
  created_by?: string | null
  spawn_args?: Record<string, unknown> | null
  sandbox?: { profile: string } | null
  parent?: string | null
  type_revision?: number | null
  inbox_schemas?: Record<string, Record<string, unknown>> | null
  state_schemas?: Record<string, Record<string, unknown>> | null
  created_at: number
  updated_at: number
}

const ENTITY_SHAPE_COLUMNS = [
  `tenant_id`,
  `url`,
  `type`,
  `status`,
  `tags`,
  `created_by`,
  `spawn_args`,
  `sandbox`,
  `parent`,
  `type_revision`,
  `inbox_schemas`,
  `state_schemas`,
  `created_at`,
  `updated_at`,
] as const

type StreamClientResolver = (
  tenantId: string
) => StreamClient | Promise<StreamClient>
type TenantIdsProvider = () => Iterable<string>

export interface EntityProjectorOptions {
  db: DrizzleDB
  electricUrl?: string
  electricSecret?: string
  streamClientForTenant: StreamClientResolver
  tenantIds?: TenantIdsProvider
}

function entityKey(tenantId: string, url: string): string {
  return `${tenantId}:${url}`
}

function projectionKey(tenantId: string, sourceRef: string): string {
  return `${tenantId}:${sourceRef}`
}

function sourceRefFromStreamPath(streamPath: string): string | null {
  const match = streamPath.match(/^\/_entities\/([^/]+)$/)
  return match?.[1] ?? null
}

function principalScopedSourceRef(
  tagSourceRef: string,
  principalUrl: string,
  principalKind: string
): string {
  return `${tagSourceRef}-${hashString(
    JSON.stringify({ principalKind, principalUrl })
  )}`
}

function sameMember(
  left: EntityMembershipRow | undefined,
  right: EntityMembershipRow
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function entityMatchesTags(entity: EntityShapeRow, tags: EntityTags): boolean {
  const required = buildTagsIndex(tags)
  if (required.length === 0) return true
  const entityTags = new Set(buildTagsIndex(entity.tags))
  return required.every((tag) => entityTags.has(tag))
}

function toMemberRow(entity: EntityShapeRow): EntityMembershipRow {
  return {
    url: entity.url,
    type: entity.type,
    status: entity.status,
    tags: entity.tags,
    spawn_args: entity.spawn_args ?? {},
    sandbox: entity.sandbox ?? null,
    parent: entity.parent ?? null,
    type_revision: entity.type_revision ?? null,
    inbox_schemas: entity.inbox_schemas ?? null,
    state_schemas: entity.state_schemas ?? null,
    created_at: entity.created_at,
    updated_at: entity.updated_at,
  }
}

class ProjectedEntityBridge {
  readonly tenantId: string
  readonly sourceRef: string
  readonly tags: EntityTags
  readonly streamUrl: string
  private readonly principalUrl?: string
  private readonly principalKind?: string
  private readonly permissionBypass: boolean

  private currentMembers = new Map<string, EntityMembershipRow>()
  private producer: IdempotentProducer | null = null
  private stopped = false

  constructor(
    row: EntityBridgeRow,
    private registry: PostgresRegistry,
    private streamClient: StreamClient
  ) {
    this.tenantId = row.tenantId
    this.sourceRef = row.sourceRef
    this.tags = normalizeTags(row.tags)
    this.streamUrl = row.streamUrl
    this.principalUrl = row.principalUrl
    this.principalKind = row.principalKind
    this.permissionBypass = isBuiltInSystemPrincipalUrl(row.principalUrl)
  }

  async start(initialEntities: Iterable<EntityShapeRow>): Promise<void> {
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
            `[entity-projector] producer write failed for ${this.tenantId}/${this.sourceRef}:`,
            error
          )
        },
      }
    )
    await this.loadCurrentMembers()
    await this.reconcile(initialEntities)
  }

  async stop(): Promise<void> {
    this.stopped = true
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

  async reconcile(entities: Iterable<EntityShapeRow>): Promise<void> {
    if (this.stopped) return

    const staleMembers = new Map(this.currentMembers)
    for (const entity of entities) {
      if (entity.tenant_id !== this.tenantId) continue
      if (!entityMatchesTags(entity, this.tags)) continue
      if (!(await this.canReadEntity(entity))) continue
      staleMembers.delete(entity.url)
      this.upsertEntity(entity)
    }

    for (const [url, row] of staleMembers) {
      this.append(`delete`, row)
      this.currentMembers.delete(url)
    }
  }

  async applyEntity(entity: EntityShapeRow): Promise<void> {
    if (this.stopped) return
    if (entity.tenant_id !== this.tenantId) return

    if (
      !entityMatchesTags(entity, this.tags) ||
      !(await this.canReadEntity(entity))
    ) {
      const existing = this.currentMembers.get(entity.url)
      if (!existing) return
      this.append(`delete`, existing)
      this.currentMembers.delete(entity.url)
      return
    }

    this.upsertEntity(entity)
  }

  deleteEntity(entity: EntityShapeRow): void {
    if (this.stopped) return
    const existing = this.currentMembers.get(entity.url)
    if (!existing) return
    this.append(`delete`, existing)
    this.currentMembers.delete(entity.url)
  }

  private upsertEntity(entity: EntityShapeRow): void {
    const next = toMemberRow(entity)
    const existing = this.currentMembers.get(entity.url)

    if (!existing) {
      this.append(`insert`, next)
      this.currentMembers.set(entity.url, next)
      return
    }

    if (!sameMember(existing, next)) {
      this.append(`update`, next)
      this.currentMembers.set(entity.url, next)
    }
  }

  private async canReadEntity(entity: EntityShapeRow): Promise<boolean> {
    if (this.permissionBypass) return true
    if (!this.principalUrl || !this.principalKind) return false
    if (entity.created_by === this.principalUrl) return true
    return await this.registry.hasEntityPermission(entity.url, `read`, {
      principalUrl: this.principalUrl,
      principalKind: this.principalKind,
    })
  }

  private async ensureStream(): Promise<void> {
    if (!(await this.streamClient.exists(this.streamUrl))) {
      await this.streamClient.create(this.streamUrl, {
        contentType: `application/json`,
      })
    }
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

  private append(
    operation: `insert` | `update` | `delete`,
    row: EntityMembershipRow
  ): void {
    if (!this.producer) {
      throw new Error(
        `[entity-projector] producer is not initialized for ${this.tenantId}/${this.sourceRef}`
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

export class EntityProjector {
  private readonly db: DrizzleDB
  private readonly electricUrl?: string
  private readonly electricSecret?: string
  private readonly streamClientForTenant: StreamClientResolver
  private readonly tenantIds?: TenantIdsProvider
  private readonly projections = new Map<string, ProjectedEntityBridge>()
  private readonly startingProjections = new Map<string, Promise<void>>()
  private readonly registries = new Map<string, PostgresRegistry>()
  private readonly activeReaders = new Map<string, number>()
  private readonly entities = new Map<string, EntityShapeRow>()
  private abortController: AbortController | null = null
  private unsubscribe: (() => void) | null = null
  private gcTimer: NodeJS.Timeout | null = null
  private started = false
  private upToDate = false
  private readyPromise: Promise<void> = Promise.resolve()
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: Error) => void) | null = null

  constructor(options: EntityProjectorOptions) {
    this.db = options.db
    this.electricUrl = options.electricUrl
    this.electricSecret = options.electricSecret
    this.streamClientForTenant = options.streamClientForTenant
    this.tenantIds = options.tenantIds
  }

  forTenant(
    tenantId: string,
    registry = new PostgresRegistry(this.db, tenantId)
  ): EntityProjectorTenantFacade {
    this.registries.set(tenantId, registry)
    return new EntityProjectorTenantFacade(this, tenantId, registry)
  }

  async start(): Promise<void> {
    if (!this.electricUrl) return
    if (this.started) {
      await this.waitUntilReady()
      return
    }

    this.started = true
    this.resetReady()
    this.startShapeStream(`-1`)
    await this.waitUntilReady()
    await this.loadPersistedBridges()

    this.gcTimer = setInterval(() => {
      void this.sweepIdleBridges().catch((error) => {
        serverLog.warn(`[entity-projector] idle sweep failed:`, error)
      })
    }, 5 * 60_000)
  }

  async stop(): Promise<void> {
    this.started = false
    this.upToDate = false
    this.unsubscribe?.()
    this.unsubscribe = null
    this.abortController?.abort()
    this.abortController = null
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }

    const projections = [...this.projections.values()]
    this.projections.clear()
    this.startingProjections.clear()
    this.activeReaders.clear()
    await Promise.all(projections.map((projection) => projection.stop()))
  }

  async register(
    tenantId: string,
    registry: PostgresRegistry,
    tagsInput: unknown,
    principalUrl: string,
    principalKind: string
  ): Promise<{ sourceRef: string; streamUrl: string }> {
    if (!this.electricUrl) {
      throw new Error(
        `[entity-projector] Electric URL is required for entities()`
      )
    }

    await this.start()
    this.registries.set(tenantId, registry)
    const tags = normalizeTags(assertTags(tagsInput))
    const sourceRef = principalScopedSourceRef(
      sourceRefForTags(tags),
      principalUrl,
      principalKind
    )
    const streamUrl = getEntitiesStreamPath(sourceRef)
    const row = await registry.upsertEntityBridge({
      sourceRef,
      tags,
      streamUrl,
      principalUrl,
      principalKind,
    })
    await registry.touchEntityBridge(sourceRef)
    await this.ensureProjection(row)

    return { sourceRef, streamUrl }
  }

  async touchByStreamPath(
    tenantId: string,
    registry: PostgresRegistry,
    streamPath: string
  ): Promise<void> {
    const sourceRef = sourceRefFromStreamPath(streamPath)
    if (!sourceRef) return
    await this.touchSourceRef(tenantId, registry, sourceRef, `head`)
    await this.ensureProjectionForSourceRef(tenantId, registry, sourceRef)
  }

  async beginClientRead(
    tenantId: string,
    registry: PostgresRegistry,
    streamPath: string
  ): Promise<(() => Promise<void>) | null> {
    const sourceRef = sourceRefFromStreamPath(streamPath)
    if (!sourceRef) return null

    const key = projectionKey(tenantId, sourceRef)
    this.activeReaders.set(key, (this.activeReaders.get(key) ?? 0) + 1)
    await this.touchSourceRef(tenantId, registry, sourceRef, `read-open`)
    await this.ensureProjectionForSourceRef(tenantId, registry, sourceRef)

    return async () => {
      const remaining = (this.activeReaders.get(key) ?? 1) - 1
      if (remaining <= 0) {
        this.activeReaders.delete(key)
      } else {
        this.activeReaders.set(key, remaining)
      }
      await this.touchSourceRef(tenantId, registry, sourceRef, `read-close`)
    }
  }

  async onEntityChanged(tenantId: string, entityUrl: string): Promise<void> {
    const entity = this.entities.get(entityKey(tenantId, entityUrl))
    if (!entity) return
    for (const projection of this.projectionsForTenant(tenantId)) {
      await projection.applyEntity(entity)
    }
  }

  async loadTenantBridges(
    tenantId: string,
    registry = this.registryForTenant(tenantId)
  ): Promise<void> {
    if (!this.started || !this.electricUrl) return
    await this.loadPersistedBridgesForTenant(tenantId, registry)
  }

  private resetReady(): void {
    this.upToDate = false
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
  }

  private async waitUntilReady(): Promise<void> {
    await this.readyPromise
  }

  private createShapeStream(
    offset: Offset,
    signal: AbortSignal
  ): ShapeStreamInterface<EntityShapeRow> {
    return new ShapeStream<EntityShapeRow>({
      url: electricUrlWithPath(this.electricUrl!, `/v1/shape`).toString(),
      params: {
        table: `entities`,
        ...(this.electricSecret ? { secret: this.electricSecret } : {}),
        columns: [...ENTITY_SHAPE_COLUMNS],
        replica: `full`,
      },
      parser: {
        int8: (value: string) => Number.parseInt(value, 10),
      },
      offset,
      signal,
      onError: (error) => {
        if (signal.aborted) {
          return {}
        }
        serverLog.warn(`[entity-projector] shared shape error:`, error)
        return {}
      },
    })
  }

  private startShapeStream(offset: Offset): void {
    if (!this.electricUrl) return

    this.unsubscribe?.()
    this.abortController?.abort()
    const abortController = new AbortController()
    const stream = this.createShapeStream(offset, abortController.signal)
    this.abortController = abortController
    this.unsubscribe = stream.subscribe(
      async (messages) => {
        await this.applyShapeMessages(messages)
      },
      (error) => {
        if (abortController.signal.aborted) {
          return
        }
        const err = error instanceof Error ? error : new Error(String(error))
        this.readyReject?.(err)
        serverLog.warn(`[entity-projector] shared subscription failed:`, error)
      }
    )
  }

  private async applyShapeMessages(
    messages: Array<Message<EntityShapeRow>>
  ): Promise<void> {
    for (const message of messages) {
      if (isControlMessage(message)) {
        if (message.headers.control === `must-refetch`) {
          this.entities.clear()
          this.resetReady()
          this.startShapeStream(`-1`)
          return
        }
        if (message.headers.control === `up-to-date`) {
          this.upToDate = true
          await this.reconcileAll()
          this.readyResolve?.()
        }
        continue
      }

      if (!isChangeMessage(message)) continue
      await this.applyChangeMessage(message)
    }
  }

  private async applyChangeMessage(
    message: ChangeMessage<EntityShapeRow>
  ): Promise<void> {
    const entity = message.value
    const key = entityKey(entity.tenant_id, entity.url)
    if (message.headers.operation === `delete`) {
      this.entities.delete(key)
      if (this.upToDate) {
        for (const projection of this.projectionsForTenant(entity.tenant_id)) {
          projection.deleteEntity(entity)
        }
      }
      return
    }

    this.entities.set(key, entity)
    if (this.upToDate) {
      for (const projection of this.projectionsForTenant(entity.tenant_id)) {
        await projection.applyEntity(entity)
      }
    }
  }

  private async loadPersistedBridges(): Promise<void> {
    const registry = new PostgresRegistry(this.db)
    const rows = await registry.listEntityBridges(null)
    const tenantIds = this.sharedTenantIds()
    const filteredRows = tenantIds
      ? rows.filter((row) => tenantIds.has(row.tenantId))
      : rows
    await Promise.all(
      filteredRows.map(async (row) => {
        try {
          this.registryForTenant(row.tenantId)
          await this.ensureProjection(row)
        } catch (error) {
          serverLog.warn(
            `[entity-projector] failed to start ${row.tenantId}/${row.sourceRef}:`,
            error
          )
        }
      })
    )
  }

  private async loadPersistedBridgesForTenant(
    tenantId: string,
    registry: PostgresRegistry
  ): Promise<void> {
    await this.waitUntilReady()
    this.registries.set(tenantId, registry)
    const rows = await registry.listEntityBridges(tenantId)
    await Promise.all(
      rows.map(async (row) => {
        try {
          await this.ensureProjection(row)
        } catch (error) {
          serverLog.warn(
            `[entity-projector] failed to start ${row.tenantId}/${row.sourceRef}:`,
            error
          )
        }
      })
    )
  }

  private registryForTenant(tenantId: string): PostgresRegistry {
    const existing = this.registries.get(tenantId)
    if (existing) return existing
    const registry = new PostgresRegistry(this.db, tenantId)
    this.registries.set(tenantId, registry)
    return registry
  }

  private async ensureProjectionForSourceRef(
    tenantId: string,
    registry: PostgresRegistry,
    sourceRef: string
  ): Promise<void> {
    await this.start()
    const row = await registry.getEntityBridge(sourceRef)
    if (!row) return
    if (row.tenantId !== tenantId) return
    await this.ensureProjection(row)
  }

  private async ensureProjection(row: EntityBridgeRow): Promise<void> {
    await this.waitUntilReady()
    const key = projectionKey(row.tenantId, row.sourceRef)
    if (this.projections.has(key)) return
    const starting = this.startingProjections.get(key)
    if (starting) {
      await starting
      return
    }

    const startPromise = (async () => {
      let streamClient: StreamClient
      try {
        streamClient = await this.streamClientForTenant(row.tenantId)
      } catch (error) {
        if (isUnregisteredTenantError(error)) {
          const message = error instanceof Error ? error.message : String(error)
          serverLog.warn(
            `[entity-projector] skipped ${row.tenantId}/${row.sourceRef} for unregistered tenant: ${message}`
          )
          return
        }
        throw error
      }
      const projection = new ProjectedEntityBridge(
        row,
        this.registryForTenant(row.tenantId),
        streamClient
      )
      await projection.start(this.entitiesForTenant(row.tenantId))
      this.projections.set(key, projection)
    })().finally(() => {
      this.startingProjections.delete(key)
    })

    this.startingProjections.set(key, startPromise)
    await startPromise
  }

  private entitiesForTenant(tenantId: string): Iterable<EntityShapeRow> {
    return [...this.entities.values()].filter(
      (entity) => entity.tenant_id === tenantId
    )
  }

  private projectionsForTenant(tenantId: string): Array<ProjectedEntityBridge> {
    return [...this.projections.values()].filter(
      (projection) => projection.tenantId === tenantId
    )
  }

  private async reconcileAll(): Promise<void> {
    for (const projection of this.projections.values()) {
      await projection.reconcile(this.entitiesForTenant(projection.tenantId))
    }
  }

  private async touchSourceRef(
    tenantId: string,
    registry: PostgresRegistry,
    sourceRef: string,
    reason: string
  ): Promise<void> {
    try {
      await registry.touchEntityBridge(sourceRef)
    } catch (error) {
      serverLog.warn(
        `[entity-projector] failed to touch ${tenantId}/${sourceRef} during ${reason}:`,
        error
      )
    }
  }

  private async sweepIdleBridges(): Promise<void> {
    const tenantIds = this.sharedTenantIds()
    for (const [tenantId, registry] of this.registries.entries()) {
      if (tenantIds && !tenantIds.has(tenantId)) continue
      const activeSourceRefs = new Set(
        await registry.listReferencedEntitySourceRefs()
      )
      for (const sourceRef of activeSourceRefs) {
        await registry.touchEntityBridge(sourceRef)
      }

      const stale = await registry.listStaleEntityBridges(
        new Date(Date.now() - 15 * 60_000)
      )

      for (const row of stale) {
        const key = projectionKey(tenantId, row.sourceRef)
        if (activeSourceRefs.has(row.sourceRef)) continue
        if ((this.activeReaders.get(key) ?? 0) > 0) continue
        const projection = this.projections.get(key)
        this.projections.delete(key)
        await projection?.stop()
        await registry.deleteEntityBridge(row.sourceRef)
      }
    }
  }

  private sharedTenantIds(): Set<string> | null {
    if (!this.tenantIds) return null
    return new Set(this.tenantIds())
  }
}

export class EntityProjectorTenantFacade implements EntityBridgeCoordinator {
  constructor(
    private readonly projector: EntityProjector,
    private readonly tenantId: string,
    private readonly registry: PostgresRegistry
  ) {}

  async start(): Promise<void> {
    await this.projector.start()
  }

  async stop(): Promise<void> {}

  async register(
    tagsInput: unknown,
    principalUrl: string,
    principalKind: string
  ): Promise<{
    sourceRef: string
    streamUrl: string
  }> {
    return await this.projector.register(
      this.tenantId,
      this.registry,
      tagsInput,
      principalUrl,
      principalKind
    )
  }

  async onEntityChanged(entityUrl: string): Promise<void> {
    await this.projector.onEntityChanged(this.tenantId, entityUrl)
  }

  async touchByStreamPath(streamPath: string): Promise<void> {
    await this.projector.touchByStreamPath(
      this.tenantId,
      this.registry,
      streamPath
    )
  }

  async beginClientRead(
    streamPath: string
  ): Promise<(() => Promise<void>) | null> {
    return await this.projector.beginClientRead(
      this.tenantId,
      this.registry,
      streamPath
    )
  }
}
