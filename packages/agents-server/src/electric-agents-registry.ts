import { and, desc, eq, lt, ne, sql } from 'drizzle-orm'
import { buildTagsIndex, normalizeTags } from '@electric-ax/agents-runtime'
import {
  entities,
  entityBridges,
  entityManifestSources,
  entityTypes,
  tagStreamOutbox,
} from './db/schema.js'
import { assertEntityStatus } from './electric-agents-types.js'
import type { DrizzleDB } from './db/index.js'
import type {
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  EntityStatus,
} from './electric-agents-types.js'
import type { EntityTags } from '@electric-ax/agents-runtime'

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

export class PostgresRegistry {
  constructor(private db: DrizzleDB) {}

  async initialize(): Promise<void> {}

  close(): void {}

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
        revision: et.revision,
        updatedAt: et.updated_at,
      })
      .where(eq(entityTypes.name, et.name))
  }

  async createEntity(entity: ElectricAgentsEntity): Promise<number> {
    try {
      const result = await this.db
        .insert(entities)
        .values({
          url: entity.url,
          type: entity.type,
          status: entity.status,
          subscriptionId: entity.subscription_id,
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
      return parseInt(result[0]!.txid)
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
