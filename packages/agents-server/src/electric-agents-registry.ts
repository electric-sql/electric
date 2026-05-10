import { and, desc, eq, lt, ne, sql } from 'drizzle-orm'
import { buildTagsIndex, normalizeTags } from '@electric-ax/agents-runtime'
import {
  consumerCallbacks,
  consumerClaims,
  entities,
  entityBridges,
  entityDispatchState,
  entityManifestSources,
  entityTypes,
  runners,
  tagStreamOutbox,
  wakeNotifications,
} from './db/schema.js'
import {
  assertEntityStatus,
  assertRunnerAdminStatus,
  assertRunnerKind,
} from './electric-agents-types.js'
import {
  redactWakeNotification,
  runnerWakeStream,
} from './dispatch-wake-router.js'
import type { DrizzleDB } from './db/index.js'
import type {
  ElectricAgentsEntity,
  DispatchTarget,
  ElectricAgentsEntityType,
  ElectricAgentsRunner,
  EntityDispatchState,
  EntityStatus,
  RunnerAdminStatus,
  RunnerKind,
  SourceStreamOffset,
  WakeClaimStatus,
  WakeDeliveryStatus,
  WakeNotificationRow,
} from './electric-agents-types.js'
import type { EntityTags, WakeNotification } from '@electric-ax/agents-runtime'

export class EntityAlreadyExistsError extends Error {
  constructor(public readonly url: string) {
    super(`Entity already exists at URL "${url}"`)
    this.name = `EntityAlreadyExistsError`
  }
}

function isDuplicateUrlError(err: unknown): boolean {
  if (!err || typeof err !== `object`) return false
  const e = err as { code?: string; constraint_name?: string }
  return e.code === `23505`
}

export interface EntityBridgeRow {
  sourceRef: string
  tags: EntityTags
  streamUrl: string
  shapeHandle?: string
  shapeOffset?: string
  lastObserverActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface TagStreamOutboxRow {
  id: number
  entityUrl: string
  collection: string
  op: `insert` | `update` | `delete`
  key: string
  rowData?: { key: string; value: string }
  attemptCount: number
  lastError?: string
  claimedBy?: string
  claimedAt?: Date
  deadLetteredAt?: Date
  createdAt: Date
}

export interface MaterializeActiveClaimInput {
  consumerId: string
  epoch: number
  entityUrl: string
  streamPath: string
  wakeId?: string
  runnerId?: string
  claimedAt?: Date
  leaseExpiresAt?: Date
}

export interface MaterializeHeartbeatClaimInput {
  consumerId: string
  epoch: number
  entityUrl: string
  streamPath: string
  leaseExpiresAt?: Date
  heartbeatAt?: Date
}

export interface MaterializeReleasedClaimInput {
  consumerId: string
  epoch?: number
  entityUrl: string
  streamPath: string
  ackedStreams?: Array<SourceStreamOffset>
  releasedAt?: Date
}

export interface MaterializeReleasedClaimResult {
  matched: boolean
  pendingSourceStreams: Array<SourceStreamOffset>
  pendingReason?: string
}

export interface ExpireStaleActiveClaimsInput {
  now?: Date
  limit?: number
}

export interface ExpiredActiveClaimRecoveryItem {
  entityUrl: string
  pendingSourceStreams: Array<SourceStreamOffset>
  pendingReason?: string
}

export interface ExpireStaleOutstandingWakesInput {
  staleBefore: Date
  now?: Date
  limit?: number
}

export interface StaleOutstandingWakeRecoveryItem {
  entityUrl: string
  wakeId: string
  pendingSourceStreams: Array<SourceStreamOffset>
  pendingReason?: string
}

export interface SupersedeStoppedEntityDispatchResult {
  matched: boolean
  outstandingWakeId?: string
  activeConsumerId?: string
  activeEpoch?: number
  clearedPendingSourceStreams: Array<SourceStreamOffset>
}

function pendingSourceStreamsFromUnknown(
  value: unknown
): Array<SourceStreamOffset> {
  return Array.isArray(value) ? (value as Array<SourceStreamOffset>) : []
}

export function recoveryItemFromExpiredDispatchStateRow(row: {
  entityUrl: string
  pendingSourceStreams?: unknown
  pendingReason?: string | null
}): ExpiredActiveClaimRecoveryItem | null {
  const pendingSourceStreams = pendingSourceStreamsFromUnknown(
    row.pendingSourceStreams
  )

  if (pendingSourceStreams.length === 0) return null

  return {
    entityUrl: row.entityUrl,
    pendingSourceStreams,
    ...(row.pendingReason ? { pendingReason: row.pendingReason } : {}),
  }
}

export function recoveryItemFromStaleOutstandingWakeRow(row: {
  entityUrl: string
  wakeId?: string | null
  pendingSourceStreams?: unknown
  pendingReason?: string | null
}): StaleOutstandingWakeRecoveryItem | null {
  if (!row.wakeId) return null

  const pendingSourceStreams = pendingSourceStreamsFromUnknown(
    row.pendingSourceStreams
  )

  if (pendingSourceStreams.length === 0) return null

  return {
    entityUrl: row.entityUrl,
    wakeId: row.wakeId,
    pendingSourceStreams,
    ...(row.pendingReason ? { pendingReason: row.pendingReason } : {}),
  }
}

export interface RegisterRunnerInput {
  id: string
  ownerUserId: string
  label: string
  kind?: RunnerKind
  adminStatus?: RunnerAdminStatus
  wakeStream?: string
}

export interface HeartbeatRunnerInput {
  runnerId: string
  heartbeatAt?: Date
  livenessLeaseExpiresAt?: Date
  leaseMs?: number
}

export interface BeginDispatchWakeInput {
  entityUrl: string
  target: Extract<DispatchTarget, { type: `webhook` | `runner` }>
  notification: WakeNotification
  sourceStreams?: Array<SourceStreamOffset>
  reason?: string
  pendingSince?: Date
  now?: Date
  runnerWakeStream?: string
}

export type BeginDispatchWakeResult =
  | {
      status: `queued`
      wakeId: string
      pendingSourceStreams: Array<SourceStreamOffset>
    }
  | {
      status: `coalesced`
      wakeId?: string
      reason: `active-claim` | `outstanding-wake`
      pendingSourceStreams: Array<SourceStreamOffset>
    }

export interface MarkWakeDeliveredInput {
  wakeId: string
  deliveredAt?: Date
  runnerWakeStream?: string
  runnerWakeStreamOffset?: string
}

export interface MarkWakeFailedInput {
  wakeId: string
  failedAt?: Date
}

function mergeSourceStreamOffsets(
  existing: Array<SourceStreamOffset>,
  incoming: Array<SourceStreamOffset>
): Array<SourceStreamOffset> {
  const byPath = new Map<string, string>()
  for (const stream of existing) {
    byPath.set(stream.path, stream.offset)
  }
  for (const stream of incoming) {
    const previous = byPath.get(stream.path)
    byPath.set(stream.path, latestOffsetString(previous, stream.offset))
  }
  return Array.from(byPath, ([path, offset]) => ({ path, offset }))
}

/**
 * Subtract source-stream offsets acknowledged by a completed claim from the
 * coalesced pending set. Offsets are compared numerically when both values
 * parse as BigInt; otherwise lexicographic ordering is used, which matches the
 * fixed-width offset strings Durable Streams emits outside plain integers.
 */
export function subtractAckedSourceStreamsFromPending(
  pending: Array<SourceStreamOffset>,
  acked: Array<SourceStreamOffset> | undefined
): Array<SourceStreamOffset> {
  if (!acked || acked.length === 0) return [...pending]

  const latestAckByPath = new Map<string, string>()
  for (const stream of acked) {
    const previous = latestAckByPath.get(stream.path)
    latestAckByPath.set(
      stream.path,
      latestOffsetString(previous, stream.offset)
    )
  }

  return pending.filter((stream) => {
    const ackOffset = latestAckByPath.get(stream.path)
    if (ackOffset === undefined) return true
    return compareOffsetStrings(ackOffset, stream.offset) < 0
  })
}

function latestOffsetString(
  previous: string | undefined,
  next: string
): string {
  if (previous === undefined) return next
  return compareOffsetStrings(next, previous) >= 0 ? next : previous
}

function compareOffsetStrings(left: string, right: string): number {
  try {
    const leftBig = BigInt(left)
    const rightBig = BigInt(right)
    return leftBig === rightBig ? 0 : leftBig > rightBig ? 1 : -1
  } catch {
    return left === right ? 0 : left > right ? 1 : -1
  }
}

export class PostgresRegistry {
  constructor(private db: DrizzleDB) {}

  async initialize(): Promise<void> {}

  close(): void {}

  async createRunner(
    input: RegisterRunnerInput
  ): Promise<ElectricAgentsRunner> {
    const now = new Date()
    const wakeStream = input.wakeStream ?? runnerWakeStream(input.id)

    await this.db
      .insert(runners)
      .values({
        id: input.id,
        ownerUserId: input.ownerUserId,
        label: input.label,
        kind: input.kind ?? `local`,
        adminStatus: input.adminStatus ?? `enabled`,
        wakeStream,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: runners.id,
        set: {
          ownerUserId: input.ownerUserId,
          label: input.label,
          kind: input.kind ?? `local`,
          adminStatus: input.adminStatus ?? `enabled`,
          wakeStream,
          updatedAt: now,
        },
      })

    const runner = await this.getRunner(input.id)
    if (!runner) {
      throw new Error(`Failed to read back runner "${input.id}"`)
    }
    return runner
  }

  async getRunner(id: string): Promise<ElectricAgentsRunner | null> {
    const rows = await this.db
      .select()
      .from(runners)
      .where(eq(runners.id, id))
      .limit(1)
    return rows[0] ? this.rowToRunner(rows[0]) : null
  }

  async listRunners(filter?: {
    ownerUserId?: string
  }): Promise<Array<ElectricAgentsRunner>> {
    const whereClause = filter?.ownerUserId
      ? eq(runners.ownerUserId, filter.ownerUserId)
      : undefined

    const rows = await this.db
      .select()
      .from(runners)
      .where(whereClause)
      .orderBy(desc(runners.createdAt))
    return rows.map((row) => this.rowToRunner(row))
  }

  async heartbeatRunner(
    input: HeartbeatRunnerInput
  ): Promise<ElectricAgentsRunner | null> {
    const now = input.heartbeatAt ?? new Date()
    const leaseExpiresAt =
      input.livenessLeaseExpiresAt ??
      new Date(now.getTime() + (input.leaseMs ?? 30_000))

    const rows = await this.db
      .update(runners)
      .set({
        lastSeenAt: now,
        livenessLeaseExpiresAt: leaseExpiresAt,
        updatedAt: now,
      })
      .where(eq(runners.id, input.runnerId))
      .returning()

    return rows[0] ? this.rowToRunner(rows[0]) : null
  }

  async setRunnerAdminStatus(
    runnerId: string,
    adminStatus: RunnerAdminStatus
  ): Promise<ElectricAgentsRunner | null> {
    const rows = await this.db
      .update(runners)
      .set({
        adminStatus,
        updatedAt: new Date(),
      })
      .where(eq(runners.id, runnerId))
      .returning()

    return rows[0] ? this.rowToRunner(rows[0]) : null
  }

  async createEntityType(et: ElectricAgentsEntityType): Promise<void> {
    await this.db
      .insert(entityTypes)
      .values({
        name: et.name,
        description: et.description,
        creationSchema: et.creation_schema ?? null,
        inboxSchemas: et.inbox_schemas ?? null,
        stateSchemas: et.state_schemas ?? null,
        serveEndpoint: et.serve_endpoint ?? null,
        defaultDispatchPolicy: et.default_dispatch_policy ?? null,
        revision: et.revision,
        createdAt: et.created_at,
        updatedAt: et.updated_at,
      })
      .onConflictDoUpdate({
        target: entityTypes.name,
        set: {
          description: et.description,
          creationSchema: et.creation_schema ?? null,
          inboxSchemas: et.inbox_schemas ?? null,
          stateSchemas: et.state_schemas ?? null,
          serveEndpoint: et.serve_endpoint ?? null,
          defaultDispatchPolicy: et.default_dispatch_policy ?? null,
          revision: et.revision,
          updatedAt: et.updated_at,
        },
      })
  }

  async getEntityType(name: string): Promise<ElectricAgentsEntityType | null> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.name, name))
      .limit(1)
    if (rows.length === 0) return null
    return this.rowToEntityType(rows[0]!)
  }

  async listEntityTypes(): Promise<Array<ElectricAgentsEntityType>> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .orderBy(entityTypes.name)
    return rows.map((row) => this.rowToEntityType(row))
  }

  async deleteEntityType(name: string): Promise<void> {
    await this.db.delete(entityTypes).where(eq(entityTypes.name, name))
  }

  async updateEntityTypeInPlace(et: ElectricAgentsEntityType): Promise<void> {
    await this.db
      .update(entityTypes)
      .set({
        description: et.description,
        creationSchema: et.creation_schema ?? null,
        inboxSchemas: et.inbox_schemas ?? null,
        stateSchemas: et.state_schemas ?? null,
        serveEndpoint: et.serve_endpoint ?? null,
        defaultDispatchPolicy: et.default_dispatch_policy ?? null,
        revision: et.revision,
        updatedAt: et.updated_at,
      })
      .where(eq(entityTypes.name, et.name))
  }

  async createEntity(entity: ElectricAgentsEntity): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx
          .insert(entities)
          .values({
            url: entity.url,
            type: entity.type,
            status: entity.status,
            subscriptionId: entity.subscription_id,
            dispatchPolicy: entity.dispatch_policy ?? null,
            writeToken: entity.write_token,
            tags: normalizeTags(entity.tags),
            tagsIndex: buildTagsIndex(entity.tags),
            spawnArgs: entity.spawn_args ?? {},
            parent: entity.parent ?? null,
            typeRevision: entity.type_revision ?? null,
            inboxSchemas: entity.inbox_schemas ?? null,
            stateSchemas: entity.state_schemas ?? null,
            createdAt: entity.created_at,
            updatedAt: entity.updated_at,
          })
          .returning({
            txid: sql<string>`pg_current_xact_id()::xid::text`,
          })

        await tx
          .insert(entityDispatchState)
          .values({
            entityUrl: entity.url,
            pendingSourceStreams: [],
            updatedAt: new Date(),
          })
          .onConflictDoNothing()

        return parseInt(result[0]!.txid)
      })
    } catch (err) {
      if (isDuplicateUrlError(err)) {
        throw new EntityAlreadyExistsError(entity.url)
      }
      throw err
    }
  }

  async getEntity(url: string): Promise<ElectricAgentsEntity | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(eq(entities.url, url))
      .limit(1)
    if (rows.length === 0) return null
    return this.rowToEntity(rows[0]!)
  }

  async getEntityByStream(
    streamPath: string
  ): Promise<ElectricAgentsEntity | null> {
    const mainSuffix = `/main`
    const errorSuffix = `/error`
    let entityUrl: string | null = null
    if (streamPath.endsWith(mainSuffix)) {
      entityUrl = streamPath.slice(0, -mainSuffix.length)
    } else if (streamPath.endsWith(errorSuffix)) {
      entityUrl = streamPath.slice(0, -errorSuffix.length)
    }
    if (!entityUrl) return null
    return this.getEntity(entityUrl)
  }

  async listEntities(filter?: {
    type?: string
    status?: string
    parent?: string
    limit?: number
    offset?: number
  }): Promise<{ entities: Array<ElectricAgentsEntity>; total: number }> {
    const conditions = []
    if (filter?.type) conditions.push(eq(entities.type, filter.type))
    if (filter?.status) conditions.push(eq(entities.status, filter.status))
    if (filter?.parent) conditions.push(eq(entities.parent, filter.parent))

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(entities)
      .where(whereClause)
    const total = Number(countResult[0]!.count)

    let query = this.db
      .select()
      .from(entities)
      .where(whereClause)
      .orderBy(desc(entities.createdAt))
      .$dynamic()

    if (filter?.limit !== undefined) {
      query = query.limit(filter.limit)
    }
    if (filter?.offset !== undefined) {
      query = query.offset(filter.offset)
    }

    const rows = await query
    return {
      entities: rows.map((row) => this.rowToEntity(row)),
      total,
    }
  }

  async updateStatus(entityUrl: string, status: EntityStatus): Promise<void> {
    const whereClause =
      status === `stopped`
        ? eq(entities.url, entityUrl)
        : and(eq(entities.url, entityUrl), ne(entities.status, `stopped`))

    await this.db
      .update(entities)
      .set({ status, updatedAt: Date.now() })
      .where(whereClause)
  }

  async updateStatusWithTxid(
    entityUrl: string,
    status: EntityStatus
  ): Promise<number> {
    return await this.db.transaction(async (tx) => {
      const whereClause =
        status === `stopped`
          ? eq(entities.url, entityUrl)
          : and(eq(entities.url, entityUrl), ne(entities.status, `stopped`))

      await tx
        .update(entities)
        .set({ status, updatedAt: Date.now() })
        .where(whereClause)
      const result = await tx.execute(
        sql`SELECT pg_current_xact_id()::xid::text AS txid`
      )
      return parseInt((result[0] as { txid: string }).txid)
    })
  }

  async ensureEntityDispatchState(entityUrl: string): Promise<void> {
    await this.db
      .insert(entityDispatchState)
      .values({
        entityUrl,
        pendingSourceStreams: [],
        updatedAt: new Date(),
      })
      .onConflictDoNothing()
  }

  async getEntityDispatchState(
    entityUrl: string
  ): Promise<EntityDispatchState> {
    await this.ensureEntityDispatchState(entityUrl)
    const rows = await this.db
      .select()
      .from(entityDispatchState)
      .where(eq(entityDispatchState.entityUrl, entityUrl))
      .limit(1)

    if (!rows[0]) {
      throw new Error(`Failed to load dispatch state for "${entityUrl}"`)
    }
    return this.rowToEntityDispatchState(rows[0])
  }

  async beginDispatchWake(
    input: BeginDispatchWakeInput
  ): Promise<BeginDispatchWakeResult> {
    const now = input.now ?? new Date()
    const sourceStreams =
      input.sourceStreams ?? input.notification.streams ?? []
    const pendingSince = input.pendingSince ?? now

    return await this.db.transaction(async (tx) => {
      await tx
        .insert(entityDispatchState)
        .values({
          entityUrl: input.entityUrl,
          pendingSourceStreams: [],
          updatedAt: now,
        })
        .onConflictDoNothing()

      const [state] = await tx
        .select()
        .from(entityDispatchState)
        .where(eq(entityDispatchState.entityUrl, input.entityUrl))
        .limit(1)
        .for(`update`)

      if (!state) {
        throw new Error(
          `Failed to lock dispatch state for "${input.entityUrl}"`
        )
      }

      const pendingSourceStreams = mergeSourceStreamOffsets(
        ((state.pendingSourceStreams as Array<SourceStreamOffset> | null) ??
          []) as Array<SourceStreamOffset>,
        sourceStreams
      )

      if (state.activeConsumerId || state.outstandingWakeId) {
        await tx
          .update(entityDispatchState)
          .set({
            pendingSourceStreams,
            pendingReason: input.reason ?? state.pendingReason,
            pendingSince,
            updatedAt: now,
          })
          .where(eq(entityDispatchState.entityUrl, input.entityUrl))

        return {
          status: `coalesced`,
          wakeId: state.outstandingWakeId ?? undefined,
          reason: state.activeConsumerId ? `active-claim` : `outstanding-wake`,
          pendingSourceStreams,
        }
      }

      const runnerWakeStreamValue =
        input.target.type === `runner`
          ? (input.runnerWakeStream ?? runnerWakeStream(input.target.runnerId))
          : null

      await tx.insert(wakeNotifications).values({
        wakeId: input.notification.wakeId,
        entityUrl: input.entityUrl,
        targetType: input.target.type,
        targetRunnerId:
          input.target.type === `runner` ? input.target.runnerId : null,
        targetWebhookUrl:
          input.target.type === `webhook` ? input.target.url : null,
        runnerWakeStream: runnerWakeStreamValue,
        notificationPublic: redactWakeNotification(input.notification),
        deliveryStatus: `queued`,
        claimStatus: `unclaimed`,
        createdAt: now,
      })

      await tx
        .update(entityDispatchState)
        .set({
          pendingSourceStreams,
          pendingReason: input.reason ?? state.pendingReason,
          pendingSince,
          outstandingWakeId: input.notification.wakeId,
          outstandingWakeTarget: input.target,
          outstandingWakeCreatedAt: now,
          lastWakeId: input.notification.wakeId,
          updatedAt: now,
        })
        .where(eq(entityDispatchState.entityUrl, input.entityUrl))

      return {
        status: `queued`,
        wakeId: input.notification.wakeId,
        pendingSourceStreams,
      }
    })
  }

  async markWakeDelivered(input: MarkWakeDeliveredInput): Promise<void> {
    const deliveredAt = input.deliveredAt ?? new Date()
    await this.db
      .update(wakeNotifications)
      .set({
        deliveryStatus: `delivered`,
        runnerWakeStream: input.runnerWakeStream,
        runnerWakeStreamOffset: input.runnerWakeStreamOffset,
        deliveredAt,
      })
      .where(eq(wakeNotifications.wakeId, input.wakeId))
  }

  async markWakeFailed(input: MarkWakeFailedInput): Promise<void> {
    const failedAt = input.failedAt ?? new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .update(wakeNotifications)
        .set({
          deliveryStatus: `failed`,
          resolvedAt: failedAt,
        })
        .where(eq(wakeNotifications.wakeId, input.wakeId))

      // A delivery failure means the wake is no longer outstanding in the
      // runner/webhook queue. Clear only the matching outstanding wake so a
      // later append can mint and deliver a fresh wake instead of coalescing
      // forever behind a failed notification.
      await tx
        .update(entityDispatchState)
        .set({
          outstandingWakeId: null,
          outstandingWakeTarget: null,
          outstandingWakeCreatedAt: null,
          updatedAt: failedAt,
        })
        .where(eq(entityDispatchState.outstandingWakeId, input.wakeId))
    })
  }

  async getWakeNotification(
    wakeId: string
  ): Promise<WakeNotificationRow | null> {
    const rows = await this.db
      .select()
      .from(wakeNotifications)
      .where(eq(wakeNotifications.wakeId, wakeId))
      .limit(1)
    return rows[0] ? this.rowToWakeNotification(rows[0]) : null
  }

  async upsertConsumerCallback(input: {
    consumerId: string
    callbackUrl: string
    primaryStream?: string | null
  }): Promise<void> {
    await this.db
      .insert(consumerCallbacks)
      .values({
        consumerId: input.consumerId,
        callbackUrl: input.callbackUrl,
        primaryStream: input.primaryStream ?? null,
      })
      .onConflictDoUpdate({
        target: consumerCallbacks.consumerId,
        set: {
          callbackUrl: input.callbackUrl,
          primaryStream: input.primaryStream ?? null,
        },
      })
  }

  async materializeActiveClaim(
    input: MaterializeActiveClaimInput
  ): Promise<void> {
    const now = input.claimedAt ?? new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .insert(consumerClaims)
        .values({
          consumerId: input.consumerId,
          epoch: input.epoch,
          wakeId: input.wakeId ?? null,
          entityUrl: input.entityUrl,
          streamPath: input.streamPath,
          runnerId: input.runnerId ?? null,
          status: `active`,
          claimedAt: now,
          leaseExpiresAt: input.leaseExpiresAt ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [consumerClaims.consumerId, consumerClaims.epoch],
          set: {
            wakeId: input.wakeId ?? null,
            entityUrl: input.entityUrl,
            streamPath: input.streamPath,
            runnerId: input.runnerId ?? null,
            status: `active`,
            leaseExpiresAt: input.leaseExpiresAt ?? null,
            releasedAt: null,
            updatedAt: now,
          },
        })

      if (input.wakeId) {
        await tx
          .update(wakeNotifications)
          .set({
            claimStatus: `claimed`,
            claimedAt: now,
          })
          .where(eq(wakeNotifications.wakeId, input.wakeId))
      }

      await tx
        .insert(entityDispatchState)
        .values({
          entityUrl: input.entityUrl,
          pendingSourceStreams: [],
          outstandingWakeId: null,
          outstandingWakeTarget: null,
          outstandingWakeCreatedAt: null,
          activeConsumerId: input.consumerId,
          activeRunnerId: input.runnerId ?? null,
          activeEpoch: input.epoch,
          activeClaimedAt: now,
          activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
          lastWakeId: input.wakeId ?? null,
          lastClaimedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: entityDispatchState.entityUrl,
          set: {
            outstandingWakeId: null,
            outstandingWakeTarget: null,
            outstandingWakeCreatedAt: null,
            activeConsumerId: input.consumerId,
            activeRunnerId: input.runnerId ?? null,
            activeEpoch: input.epoch,
            activeClaimedAt: now,
            activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
            lastWakeId: input.wakeId ?? null,
            lastClaimedAt: now,
            updatedAt: now,
          },
        })
    })
  }

  async materializeHeartbeatClaim(
    input: MaterializeHeartbeatClaimInput
  ): Promise<boolean> {
    const now = input.heartbeatAt ?? new Date()
    return await this.db.transaction(async (tx) => {
      await tx
        .update(consumerClaims)
        .set({
          lastHeartbeatAt: now,
          ...(input.leaseExpiresAt
            ? { leaseExpiresAt: input.leaseExpiresAt }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(consumerClaims.consumerId, input.consumerId),
            eq(consumerClaims.epoch, input.epoch)
          )
        )

      const matched = await tx
        .update(entityDispatchState)
        .set({
          ...(input.leaseExpiresAt
            ? { activeLeaseExpiresAt: input.leaseExpiresAt }
            : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(entityDispatchState.entityUrl, input.entityUrl),
            eq(entityDispatchState.activeConsumerId, input.consumerId),
            eq(entityDispatchState.activeEpoch, input.epoch)
          )
        )
        .returning({ entityUrl: entityDispatchState.entityUrl })

      return matched.length > 0
    })
  }

  async materializeReleasedClaim(
    input: MaterializeReleasedClaimInput
  ): Promise<MaterializeReleasedClaimResult> {
    if (input.epoch === undefined) {
      return { matched: false, pendingSourceStreams: [] }
    }

    const epoch = input.epoch
    const now = input.releasedAt ?? new Date()
    return await this.db.transaction(async (tx) => {
      await tx
        .insert(consumerClaims)
        .values({
          consumerId: input.consumerId,
          epoch,
          entityUrl: input.entityUrl,
          streamPath: input.streamPath,
          status: `released`,
          claimedAt: now,
          releasedAt: now,
          ackedStreams: input.ackedStreams ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [consumerClaims.consumerId, consumerClaims.epoch],
          set: {
            entityUrl: input.entityUrl,
            streamPath: input.streamPath,
            status: `released`,
            releasedAt: now,
            ackedStreams: input.ackedStreams ?? null,
            updatedAt: now,
          },
        })

      const [state] = await tx
        .select()
        .from(entityDispatchState)
        .where(
          and(
            eq(entityDispatchState.entityUrl, input.entityUrl),
            eq(entityDispatchState.activeConsumerId, input.consumerId),
            eq(entityDispatchState.activeEpoch, epoch)
          )
        )
        .limit(1)
        .for(`update`)

      if (!state) {
        const [currentState] = await tx
          .select({ activeConsumerId: entityDispatchState.activeConsumerId })
          .from(entityDispatchState)
          .where(eq(entityDispatchState.entityUrl, input.entityUrl))
          .limit(1)
          .for(`update`)

        if (currentState && !currentState.activeConsumerId) {
          return { matched: true, pendingSourceStreams: [] }
        }

        return { matched: false, pendingSourceStreams: [] }
      }

      const remainingPending = subtractAckedSourceStreamsFromPending(
        ((state.pendingSourceStreams as Array<SourceStreamOffset> | null) ??
          []) as Array<SourceStreamOffset>,
        input.ackedStreams
      )
      const hasPending = remainingPending.length > 0
      const pendingReason = hasPending
        ? (state.pendingReason ?? `pending_coalesced_wake`)
        : null

      if (state.lastWakeId) {
        await tx
          .update(wakeNotifications)
          .set({
            claimStatus: `completed`,
            resolvedAt: now,
          })
          .where(eq(wakeNotifications.wakeId, state.lastWakeId))
      }

      await tx
        .update(entityDispatchState)
        .set({
          pendingSourceStreams: remainingPending,
          pendingReason,
          pendingSince: hasPending ? (state.pendingSince ?? now) : null,
          activeConsumerId: null,
          activeRunnerId: null,
          activeEpoch: null,
          activeClaimedAt: null,
          activeLeaseExpiresAt: null,
          lastReleasedAt: now,
          lastCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(entityDispatchState.entityUrl, input.entityUrl))

      return {
        matched: true,
        pendingSourceStreams: remainingPending,
        ...(pendingReason ? { pendingReason } : {}),
      }
    })
  }

  async supersedeDispatchForStoppedEntity(input: {
    entityUrl: string
    now?: Date
  }): Promise<SupersedeStoppedEntityDispatchResult> {
    const now = input.now ?? new Date()

    return await this.db.transaction(async (tx) => {
      const [state] = await tx
        .select()
        .from(entityDispatchState)
        .where(eq(entityDispatchState.entityUrl, input.entityUrl))
        .limit(1)
        .for(`update`)

      if (!state) {
        return { matched: false, clearedPendingSourceStreams: [] }
      }

      const clearedPendingSourceStreams = pendingSourceStreamsFromUnknown(
        state.pendingSourceStreams
      )
      const outstandingWakeId = state.outstandingWakeId ?? undefined
      const activeConsumerId = state.activeConsumerId ?? undefined
      const activeEpoch = state.activeEpoch ?? undefined

      await tx
        .update(entityDispatchState)
        .set({
          pendingSourceStreams: [],
          pendingReason: null,
          pendingSince: null,
          outstandingWakeId: null,
          outstandingWakeTarget: null,
          outstandingWakeCreatedAt: null,
          activeConsumerId: null,
          activeRunnerId: null,
          activeEpoch: null,
          activeClaimedAt: null,
          activeLeaseExpiresAt: null,
          lastReleasedAt:
            outstandingWakeId || activeConsumerId ? now : state.lastReleasedAt,
          updatedAt: now,
        })
        .where(eq(entityDispatchState.entityUrl, input.entityUrl))

      if (outstandingWakeId) {
        await tx
          .update(wakeNotifications)
          .set({
            deliveryStatus: `superseded`,
            claimStatus: `expired`,
            resolvedAt: now,
          })
          .where(eq(wakeNotifications.wakeId, outstandingWakeId))
      }

      if (activeConsumerId && activeEpoch !== undefined) {
        await tx
          .update(consumerClaims)
          .set({
            status: `failed`,
            releasedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(consumerClaims.consumerId, activeConsumerId),
              eq(consumerClaims.epoch, activeEpoch)
            )
          )
      }

      return {
        matched: true,
        ...(outstandingWakeId ? { outstandingWakeId } : {}),
        ...(activeConsumerId ? { activeConsumerId } : {}),
        ...(activeEpoch !== undefined ? { activeEpoch } : {}),
        clearedPendingSourceStreams,
      }
    })
  }

  async expireStaleActiveClaims(
    input: ExpireStaleActiveClaimsInput = {}
  ): Promise<Array<ExpiredActiveClaimRecoveryItem>> {
    const now = input.now ?? new Date()
    const nowIso = now.toISOString()
    const limit = Math.floor(input.limit ?? 100)
    if (limit <= 0) return []

    return await this.db.transaction(async (tx) => {
      // last_released_at is the existing terminal timestamp for a claim that is
      // no longer active; last_completed_at is intentionally left unchanged.
      const rows = await tx.execute(sql`
        WITH candidates AS (
          SELECT
            ${entityDispatchState.entityUrl} AS entity_url,
            ${entityDispatchState.activeConsumerId} AS active_consumer_id,
            ${entityDispatchState.activeEpoch} AS active_epoch
          FROM ${entityDispatchState}
          WHERE ${entityDispatchState.activeConsumerId} IS NOT NULL
            AND ${entityDispatchState.activeEpoch} IS NOT NULL
            AND (
              ${entityDispatchState.activeLeaseExpiresAt} < ${nowIso}::timestamptz
              OR (
                ${entityDispatchState.activeLeaseExpiresAt} IS NULL
                AND ${entityDispatchState.activeClaimedAt} IS NOT NULL
                AND ${entityDispatchState.activeClaimedAt} < (${nowIso}::timestamptz - interval '30 seconds')
              )
            )
          ORDER BY COALESCE(${entityDispatchState.activeLeaseExpiresAt}, ${entityDispatchState.activeClaimedAt}) ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${entityDispatchState}
           SET active_consumer_id = NULL,
               active_runner_id = NULL,
               active_epoch = NULL,
               active_claimed_at = NULL,
               active_lease_expires_at = NULL,
               last_released_at = ${nowIso}::timestamptz,
               updated_at = ${nowIso}::timestamptz
          FROM candidates
         WHERE ${entityDispatchState.entityUrl} = candidates.entity_url
        RETURNING
          ${entityDispatchState.entityUrl} AS "entityUrl",
          candidates.active_consumer_id AS "consumerId",
          candidates.active_epoch AS "epoch",
          ${entityDispatchState.pendingSourceStreams} AS "pendingSourceStreams",
          ${entityDispatchState.pendingReason} AS "pendingReason"
      `)

      const expiredRows = rows as unknown as Array<{
        entityUrl: string
        consumerId: string
        epoch: number
        pendingSourceStreams?: unknown
        pendingReason?: string | null
      }>

      for (const row of expiredRows) {
        await tx
          .update(consumerClaims)
          .set({
            status: `expired`,
            // Expiry uses releasedAt as the existing terminal timestamp; it is
            // not a successful completion marker.
            releasedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(consumerClaims.consumerId, row.consumerId),
              eq(consumerClaims.epoch, row.epoch)
            )
          )
      }

      return expiredRows.flatMap((row) => {
        const item = recoveryItemFromExpiredDispatchStateRow(row)
        return item ? [item] : []
      })
    })
  }

  async expireStaleOutstandingWakes(
    input: ExpireStaleOutstandingWakesInput
  ): Promise<Array<StaleOutstandingWakeRecoveryItem>> {
    const now = input.now ?? new Date()
    const nowIso = now.toISOString()
    const staleBeforeIso = input.staleBefore.toISOString()
    const limit = Math.floor(input.limit ?? 100)
    if (limit <= 0) return []

    return await this.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        WITH candidates AS (
          SELECT
            ${entityDispatchState.entityUrl} AS entity_url,
            ${entityDispatchState.outstandingWakeId} AS outstanding_wake_id
          FROM ${entityDispatchState}
          WHERE ${entityDispatchState.outstandingWakeId} IS NOT NULL
            AND ${entityDispatchState.activeConsumerId} IS NULL
            AND ${entityDispatchState.outstandingWakeCreatedAt} IS NOT NULL
            AND ${entityDispatchState.outstandingWakeCreatedAt} < ${staleBeforeIso}::timestamptz
          ORDER BY ${entityDispatchState.outstandingWakeCreatedAt} ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${entityDispatchState}
           SET outstanding_wake_id = NULL,
               outstanding_wake_target = NULL,
               outstanding_wake_created_at = NULL,
               pending_reason = COALESCE(${entityDispatchState.pendingReason}, 'stale_outstanding_wake'),
               updated_at = ${nowIso}::timestamptz
          FROM candidates
         WHERE ${entityDispatchState.entityUrl} = candidates.entity_url
        RETURNING
          ${entityDispatchState.entityUrl} AS "entityUrl",
          candidates.outstanding_wake_id AS "wakeId",
          ${entityDispatchState.pendingSourceStreams} AS "pendingSourceStreams",
          ${entityDispatchState.pendingReason} AS "pendingReason"
      `)

      const staleRows = rows as unknown as Array<{
        entityUrl: string
        wakeId: string | null
        pendingSourceStreams?: unknown
        pendingReason?: string | null
      }>

      for (const row of staleRows) {
        if (!row.wakeId) continue
        await tx
          .update(wakeNotifications)
          .set({
            deliveryStatus: `superseded`,
            claimStatus: `expired`,
            resolvedAt: now,
          })
          .where(eq(wakeNotifications.wakeId, row.wakeId))
      }

      return staleRows.flatMap((row) => {
        const item = recoveryItemFromStaleOutstandingWakeRow(row)
        return item ? [item] : []
      })
    })
  }

  async setEntityTag(
    url: string,
    key: string,
    value: string
  ): Promise<{
    entity: ElectricAgentsEntity | null
    changed: boolean
    op?: `insert` | `update` | `delete`
  }> {
    return this.mutateEntityTags(url, (oldTags) => {
      const previous = oldTags[key]
      if (previous === value) return null
      return {
        nextTags: { ...oldTags, [key]: value },
        outbox: {
          op: previous === undefined ? `insert` : `update`,
          key,
          rowData: { key, value },
        },
      }
    })
  }

  async removeEntityTag(
    url: string,
    key: string
  ): Promise<{ entity: ElectricAgentsEntity | null; changed: boolean }> {
    return this.mutateEntityTags(url, (oldTags) => {
      if (!(key in oldTags)) return null
      const { [key]: _removed, ...remaining } = oldTags
      return {
        nextTags: remaining,
        outbox: { op: `delete`, key },
      }
    })
  }

  private async mutateEntityTags(
    url: string,
    compute: (oldTags: EntityTags) => {
      nextTags: EntityTags
      outbox: {
        op: `insert` | `update` | `delete`
        key: string
        rowData?: { key: string; value: string }
      }
    } | null
  ): Promise<{
    entity: ElectricAgentsEntity | null
    changed: boolean
    op?: `insert` | `update`
  }> {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(entities)
        .where(eq(entities.url, url))
        .limit(1)
        .for(`update`)
      if (!row) {
        return { entity: null, changed: false }
      }

      const oldTags = (row.tags as EntityTags | null | undefined) ?? {}
      const mutation = compute(oldTags)
      if (!mutation) {
        return { entity: this.rowToEntity(row), changed: false }
      }

      const nextTags = normalizeTags(mutation.nextTags)
      const updatedAt = Date.now()
      await tx
        .update(entities)
        .set({
          tags: nextTags,
          tagsIndex: buildTagsIndex(nextTags),
          updatedAt,
        })
        .where(eq(entities.url, url))

      await tx.insert(tagStreamOutbox).values({
        entityUrl: url,
        collection: `tags`,
        op: mutation.outbox.op,
        key: mutation.outbox.key,
        rowData: mutation.outbox.rowData,
      })

      const entity = this.rowToEntity({
        ...row,
        tags: nextTags,
        updatedAt,
      })
      const op = mutation.outbox.op
      return {
        entity,
        changed: true,
        ...(op === `insert` || op === `update` ? { op } : {}),
      }
    })
  }

  async upsertEntityBridge(row: {
    sourceRef: string
    tags: EntityTags
    streamUrl: string
  }): Promise<EntityBridgeRow> {
    await this.db
      .insert(entityBridges)
      .values({
        sourceRef: row.sourceRef,
        tags: normalizeTags(row.tags),
        streamUrl: row.streamUrl,
      })
      .onConflictDoNothing()

    const existing = await this.getEntityBridge(row.sourceRef)
    if (!existing) {
      throw new Error(`Failed to load entity bridge ${row.sourceRef}`)
    }
    return existing
  }

  async getEntityBridge(sourceRef: string): Promise<EntityBridgeRow | null> {
    const rows = await this.db
      .select()
      .from(entityBridges)
      .where(eq(entityBridges.sourceRef, sourceRef))
      .limit(1)
    return rows[0] ? this.rowToEntityBridge(rows[0]) : null
  }

  async listEntityBridges(): Promise<Array<EntityBridgeRow>> {
    const rows = await this.db.select().from(entityBridges)
    return rows.map((row) => this.rowToEntityBridge(row))
  }

  async listStaleEntityBridges(before: Date): Promise<Array<EntityBridgeRow>> {
    const rows = await this.db
      .select()
      .from(entityBridges)
      .where(lt(entityBridges.lastObserverActivityAt, before))
    return rows.map((row) => this.rowToEntityBridge(row))
  }

  async replaceEntityManifestSource(
    ownerEntityUrl: string,
    manifestKey: string,
    sourceRef?: string
  ): Promise<void> {
    await this.db
      .delete(entityManifestSources)
      .where(
        and(
          eq(entityManifestSources.ownerEntityUrl, ownerEntityUrl),
          eq(entityManifestSources.manifestKey, manifestKey)
        )
      )

    if (!sourceRef) {
      return
    }

    await this.db
      .insert(entityManifestSources)
      .values({
        ownerEntityUrl,
        manifestKey,
        sourceRef,
      })
      .onConflictDoUpdate({
        target: [
          entityManifestSources.ownerEntityUrl,
          entityManifestSources.manifestKey,
        ],
        set: {
          sourceRef,
          updatedAt: new Date(),
        },
      })
  }

  async clearEntityManifestSources(): Promise<void> {
    await this.db.delete(entityManifestSources)
  }

  async listReferencedEntitySourceRefs(): Promise<Array<string>> {
    const rows = await this.db
      .selectDistinct({ sourceRef: entityManifestSources.sourceRef })
      .from(entityManifestSources)
      .orderBy(entityManifestSources.sourceRef)
    return rows.map((row) => row.sourceRef)
  }

  async touchEntityBridge(sourceRef: string): Promise<void> {
    await this.db
      .update(entityBridges)
      .set({
        lastObserverActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(entityBridges.sourceRef, sourceRef))
  }

  async updateEntityBridgeCursor(
    sourceRef: string,
    shapeHandle: string,
    shapeOffset: string
  ): Promise<void> {
    await this.db
      .update(entityBridges)
      .set({
        shapeHandle,
        shapeOffset,
        updatedAt: new Date(),
      })
      .where(eq(entityBridges.sourceRef, sourceRef))
  }

  async clearEntityBridgeCursor(sourceRef: string): Promise<void> {
    await this.db
      .update(entityBridges)
      .set({
        shapeHandle: null,
        shapeOffset: null,
        updatedAt: new Date(),
      })
      .where(eq(entityBridges.sourceRef, sourceRef))
  }

  async deleteEntityBridge(sourceRef: string): Promise<void> {
    await this.db
      .delete(entityBridges)
      .where(eq(entityBridges.sourceRef, sourceRef))
  }

  // The 30-second window is the claim lease TTL: if a worker crashes mid-
  // publish, its claim is reclaimable by another worker after 30s. Pairs
  // with DRAIN_INTERVAL_MS=500 — short enough that recovery is fast, long
  // enough that a healthy in-flight publish won't be stolen.
  async claimTagOutboxRows(
    workerId: string,
    limit = 25
  ): Promise<Array<TagStreamOutboxRow>> {
    const claimed = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id
          FROM ${tagStreamOutbox}
         WHERE ${tagStreamOutbox.deadLetteredAt} IS NULL
           AND (
             ${tagStreamOutbox.claimedAt} IS NULL
             OR ${tagStreamOutbox.claimedAt} < now() - interval '30 seconds'
           )
         ORDER BY ${tagStreamOutbox.createdAt}
         LIMIT ${limit}
         FOR UPDATE SKIP LOCKED
      )
      UPDATE ${tagStreamOutbox}
         SET claimed_by = ${workerId},
             claimed_at = now()
       WHERE ${tagStreamOutbox.id} IN (SELECT id FROM candidates)
      RETURNING
        id,
        entity_url AS "entityUrl",
        collection,
        op,
        key,
        row_data AS "rowData",
        attempt_count AS "attemptCount",
        last_error AS "lastError",
        claimed_by AS "claimedBy",
        claimed_at AS "claimedAt",
        dead_lettered_at AS "deadLetteredAt",
        created_at AS "createdAt"
    `)

    return (
      claimed as unknown as Array<{
        id: number
        entityUrl: string
        collection: string
        op: `insert` | `update` | `delete`
        key: string
        rowData?: { key: string; value: string } | null
        attemptCount: number
        lastError?: string | null
        claimedBy?: string | null
        claimedAt?: Date | null
        deadLetteredAt?: Date | null
        createdAt: Date
      }>
    ).map((row) => this.rowToTagStreamOutbox(row))
  }

  async failTagOutboxRow(
    id: number,
    workerId: string,
    errorMessage: string,
    maxAttempts: number
  ): Promise<{ attemptCount: number; deadLettered: boolean }> {
    const [row] = await this.db.execute(sql`
      UPDATE ${tagStreamOutbox}
         SET attempt_count = ${tagStreamOutbox.attemptCount} + 1,
             last_error = ${errorMessage},
             claimed_by = null,
             claimed_at = null,
             dead_lettered_at = CASE
               WHEN ${tagStreamOutbox.attemptCount} + 1 >= ${maxAttempts}
                 THEN now()
               ELSE ${tagStreamOutbox.deadLetteredAt}
             END
       WHERE ${tagStreamOutbox.id} = ${id}
         AND ${tagStreamOutbox.claimedBy} = ${workerId}
      RETURNING
        attempt_count AS "attemptCount",
        dead_lettered_at AS "deadLetteredAt"
    `)

    if (!row) {
      throw new Error(`Failed to mark tag outbox row ${id} as failed`)
    }

    const typedRow = row as {
      attemptCount: number
      deadLetteredAt?: Date | null
    }
    return {
      attemptCount: typedRow.attemptCount,
      deadLettered: typedRow.deadLetteredAt != null,
    }
  }

  async deleteTagOutboxRow(id: number): Promise<void> {
    await this.db.delete(tagStreamOutbox).where(eq(tagStreamOutbox.id, id))
  }

  async releaseTagOutboxClaims(workerId: string): Promise<void> {
    await this.db
      .update(tagStreamOutbox)
      .set({
        claimedBy: null,
        claimedAt: null,
      })
      .where(
        and(
          eq(tagStreamOutbox.claimedBy, workerId),
          sql`${tagStreamOutbox.deadLetteredAt} IS NULL`
        )
      )
  }

  async deleteEntity(url: string): Promise<void> {
    await this.db.delete(entities).where(eq(entities.url, url))
  }

  private rowToEntityDispatchState(
    row: typeof entityDispatchState.$inferSelect
  ): EntityDispatchState {
    return {
      entity_url: row.entityUrl,
      pending_source_streams:
        (row.pendingSourceStreams as Array<SourceStreamOffset> | null) ?? [],
      pending_reason: row.pendingReason ?? undefined,
      pending_since: row.pendingSince?.toISOString(),
      outstanding_wake_id: row.outstandingWakeId ?? undefined,
      outstanding_wake_target:
        (row.outstandingWakeTarget as DispatchTarget | null | undefined) ??
        undefined,
      outstanding_wake_created_at: row.outstandingWakeCreatedAt?.toISOString(),
      active_consumer_id: row.activeConsumerId ?? undefined,
      active_runner_id: row.activeRunnerId ?? undefined,
      active_epoch: row.activeEpoch ?? undefined,
      active_claimed_at: row.activeClaimedAt?.toISOString(),
      active_lease_expires_at: row.activeLeaseExpiresAt?.toISOString(),
      last_wake_id: row.lastWakeId ?? undefined,
      last_claimed_at: row.lastClaimedAt?.toISOString(),
      last_released_at: row.lastReleasedAt?.toISOString(),
      last_completed_at: row.lastCompletedAt?.toISOString(),
      last_error: row.lastError ?? undefined,
      updated_at: row.updatedAt.toISOString(),
    }
  }

  private rowToWakeNotification(
    row: typeof wakeNotifications.$inferSelect
  ): WakeNotificationRow {
    return {
      wake_id: row.wakeId,
      entity_url: row.entityUrl,
      target_type: row.targetType as DispatchTarget[`type`],
      target_runner_id: row.targetRunnerId ?? undefined,
      target_webhook_url: row.targetWebhookUrl ?? undefined,
      target_worker_pool_id: row.targetWorkerPoolId ?? undefined,
      runner_wake_stream: row.runnerWakeStream ?? undefined,
      runner_wake_stream_offset: row.runnerWakeStreamOffset ?? undefined,
      notification_public:
        row.notificationPublic as WakeNotificationRow[`notification_public`],
      delivery_status: row.deliveryStatus as WakeDeliveryStatus,
      claim_status: row.claimStatus as WakeClaimStatus,
      created_at: row.createdAt.toISOString(),
      delivered_at: row.deliveredAt?.toISOString(),
      claimed_at: row.claimedAt?.toISOString(),
      resolved_at: row.resolvedAt?.toISOString(),
    }
  }

  private rowToRunner(row: typeof runners.$inferSelect): ElectricAgentsRunner {
    const leaseExpiresAt = row.livenessLeaseExpiresAt ?? undefined
    return {
      id: row.id,
      owner_user_id: row.ownerUserId,
      label: row.label,
      kind: assertRunnerKind(row.kind),
      admin_status: assertRunnerAdminStatus(row.adminStatus),
      liveness:
        leaseExpiresAt && leaseExpiresAt.getTime() > Date.now()
          ? `online`
          : `offline`,
      last_seen_at: row.lastSeenAt?.toISOString(),
      liveness_lease_expires_at: leaseExpiresAt?.toISOString(),
      wake_stream: row.wakeStream,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }

  private rowToEntityType(
    row: typeof entityTypes.$inferSelect
  ): ElectricAgentsEntityType {
    return {
      name: row.name,
      description: row.description,
      creation_schema: row.creationSchema as
        | Record<string, unknown>
        | undefined,
      inbox_schemas: row.inboxSchemas as
        | Record<string, Record<string, unknown>>
        | undefined,
      state_schemas: row.stateSchemas as
        | Record<string, Record<string, unknown>>
        | undefined,
      serve_endpoint: row.serveEndpoint ?? undefined,
      default_dispatch_policy:
        (row.defaultDispatchPolicy as
          | ElectricAgentsEntityType[`default_dispatch_policy`]
          | null
          | undefined) ?? undefined,
      revision: row.revision,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private rowToEntity(row: typeof entities.$inferSelect): ElectricAgentsEntity {
    return {
      url: row.url,
      type: row.type,
      status: assertEntityStatus(row.status),
      streams: {
        main: `${row.url}/main`,
        error: `${row.url}/error`,
      },
      subscription_id: row.subscriptionId,
      dispatch_policy:
        (row.dispatchPolicy as
          | ElectricAgentsEntity[`dispatch_policy`]
          | null) ?? undefined,
      write_token: row.writeToken,
      tags: (row.tags as EntityTags | null | undefined) ?? {},
      spawn_args: row.spawnArgs as Record<string, unknown> | undefined,
      parent: row.parent ?? undefined,
      type_revision: row.typeRevision ?? undefined,
      inbox_schemas: row.inboxSchemas as
        | Record<string, Record<string, unknown>>
        | undefined,
      state_schemas: row.stateSchemas as
        | Record<string, Record<string, unknown>>
        | undefined,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private rowToEntityBridge(
    row: typeof entityBridges.$inferSelect
  ): EntityBridgeRow {
    return {
      sourceRef: row.sourceRef,
      tags: (row.tags as EntityTags | null | undefined) ?? {},
      streamUrl: row.streamUrl,
      shapeHandle: row.shapeHandle ?? undefined,
      shapeOffset: row.shapeOffset ?? undefined,
      lastObserverActivityAt: row.lastObserverActivityAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private rowToTagStreamOutbox(row: {
    id: number
    entityUrl: string
    collection: string
    op: string
    key: string
    rowData?: { key: string; value: string } | null
    attemptCount: number
    lastError?: string | null
    claimedBy?: string | null
    claimedAt?: Date | null
    deadLetteredAt?: Date | null
    createdAt: Date
  }): TagStreamOutboxRow {
    return {
      id: row.id,
      entityUrl: row.entityUrl,
      collection: row.collection,
      op: row.op as `insert` | `update` | `delete`,
      key: row.key,
      rowData:
        (row.rowData as { key: string; value: string } | null | undefined) ??
        undefined,
      attemptCount: row.attemptCount,
      lastError: row.lastError ?? undefined,
      claimedBy: row.claimedBy ?? undefined,
      claimedAt: row.claimedAt ?? undefined,
      deadLetteredAt: row.deadLetteredAt ?? undefined,
      createdAt: row.createdAt,
    }
  }
}
