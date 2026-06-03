import { and, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import { buildTagsIndex, normalizeTags } from '@electric-ax/agents-runtime'
import {
  consumerClaims,
  entities,
  entityEffectivePermissions,
  entityBridges,
  entityDispatchState,
  entityManifestSources,
  entityLineage,
  entityPermissionGrants,
  entityTypes,
  entityTypePermissionGrants,
  runnerRuntimeDiagnostics,
  runners,
  sharedStateLinks,
  tagStreamOutbox,
} from './db/schema.js'
import {
  assertEntityStatus,
  assertRunnerAdminStatus,
  assertRunnerKind,
  isTerminalEntityStatus,
} from './electric-agents-types.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import type { DrizzleDB } from './db/index.js'
import type {
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  ElectricAgentsRunner,
  EntityStatus,
  RunnerAdminStatus,
  RunnerKind,
  SandboxProfileAdvertisement,
  SourceStreamOffset,
  ConsumerClaim,
  DispatchPolicy,
  EntityPermission,
  EntityPermissionGrant,
  EntityPermissionPropagation,
  EntityTypePermission,
  EntityTypePermissionGrant,
  PermissionSubjectKind,
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
  tenantId: string
  sourceRef: string
  tags: EntityTags
  streamUrl: string
  principalUrl?: string
  principalKind?: string
  shapeHandle?: string
  shapeOffset?: string
  lastObserverActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface TagStreamOutboxRow {
  id: number
  tenantId: string
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

export interface RegisterRunnerInput {
  id: string
  ownerPrincipal: string
  label: string
  kind?: RunnerKind
  adminStatus?: RunnerAdminStatus
  wakeStream?: string
  /**
   * Full-set replacement: provide the complete list of profiles the
   * runner currently exposes. Existing rows for the runner are
   * removed and the supplied set is inserted in one transaction.
   * Omit (or pass undefined) to leave the existing set untouched.
   */
  sandboxProfiles?: ReadonlyArray<SandboxProfileAdvertisement>
}

export interface HeartbeatRunnerInput {
  runnerId: string
  ownerPrincipal: string
  heartbeatAt?: Date
  livenessLeaseExpiresAt?: Date
  leaseMs?: number
  wakeStreamOffset?: string
  diagnostics?: Record<string, unknown>
}

export interface RunnerRuntimeDiagnostics {
  runner_id: string
  owner_principal: string
  wake_stream_offset?: string
  last_seen_at: string
  liveness_lease_expires_at: string
  diagnostics?: Record<string, unknown>
  updated_at: string
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
  heartbeatAt?: Date
  leaseExpiresAt?: Date
}

export interface MaterializeReleasedClaimInput {
  consumerId: string
  epoch: number
  ackedStreams?: Array<SourceStreamOffset>
  releasedAt?: Date
}

export interface CreateEntityTypePermissionGrantInput {
  entityType: string
  permission: EntityTypePermission
  subjectKind: PermissionSubjectKind
  subjectValue: string
  createdBy?: string
  expiresAt?: Date
}

export interface CreateEntityPermissionGrantInput {
  entityUrl: string
  permission: EntityPermission
  subjectKind: PermissionSubjectKind
  subjectValue: string
  propagation?: EntityPermissionPropagation
  copyToChildren?: boolean
  createdBy?: string
  expiresAt?: Date
}

const DEFAULT_RUNNER_LEASE_MS = 30_000
const PERMISSION_PRUNE_INTERVAL_MS = 30_000

type RegistryTransaction = Parameters<
  Parameters<DrizzleDB[`transaction`]>[0]
>[0]

export function runnerWakeStream(runnerId: string): string {
  return `/runners/${runnerId}/wake`
}

export class PostgresRegistry {
  // Electric predicates cannot depend on now(), so expired effective rows need a
  // server-side sweep. Debounce it to keep read/auth paths from writing on every request.
  private lastPermissionPruneStartedAt = 0
  private permissionPrunePromise: Promise<void> | null = null

  constructor(
    private db: DrizzleDB,
    readonly tenantId: string = DEFAULT_TENANT_ID
  ) {}

  async initialize(): Promise<void> {}

  close(): void {}

  async createRunner(
    input: RegisterRunnerInput
  ): Promise<ElectricAgentsRunner> {
    const now = new Date()
    const wakeStream = input.wakeStream ?? runnerWakeStream(input.id)
    // Full-set replace: when the caller provides a profile list it
    // overwrites whatever the runner previously advertised. Omitting
    // the field on a re-registration preserves the existing value.
    const sandboxProfilesValue = input.sandboxProfiles
      ? input.sandboxProfiles.map((p) => ({
          name: p.name,
          label: p.label,
          ...(p.description !== undefined && { description: p.description }),
          ...(p.remote !== undefined && { remote: p.remote }),
        }))
      : undefined

    await this.db
      .insert(runners)
      .values({
        tenantId: this.tenantId,
        id: input.id,
        ownerPrincipal: input.ownerPrincipal,
        label: input.label,
        kind: input.kind ?? `local`,
        adminStatus: input.adminStatus ?? `enabled`,
        wakeStream,
        ...(sandboxProfilesValue !== undefined && {
          sandboxProfiles: sandboxProfilesValue,
        }),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [runners.tenantId, runners.id],
        set: {
          ownerPrincipal: input.ownerPrincipal,
          label: input.label,
          kind: input.kind ?? `local`,
          adminStatus: input.adminStatus ?? `enabled`,
          wakeStream,
          ...(sandboxProfilesValue !== undefined && {
            sandboxProfiles: sandboxProfilesValue,
          }),
          updatedAt: now,
        },
      })

    const runner = await this.getRunner(input.id)
    if (!runner) {
      throw new Error(`Failed to read back runner "${input.id}"`)
    }
    return runner
  }

  /**
   * Every sandbox profile advertised by a runner in this tenant (one entry
   * per runner that advertises it — names may repeat across runners). Used by
   * spawn validation for unpinned dispatch to learn whether a chosen profile
   * is remote (so a shared sandbox can skip the single-runner guard).
   */
  async listSandboxProfiles(): Promise<Array<SandboxProfileAdvertisement>> {
    const rows = await this.db
      .select({ sandboxProfiles: runners.sandboxProfiles })
      .from(runners)
      .where(eq(runners.tenantId, this.tenantId))
    const profiles: Array<SandboxProfileAdvertisement> = []
    for (const row of rows) {
      const list = row.sandboxProfiles as
        | Array<{
            name?: unknown
            label?: unknown
            description?: unknown
            remote?: unknown
          }>
        | null
        | undefined
      if (!Array.isArray(list)) continue
      for (const entry of list) {
        if (!entry || typeof entry.name !== `string`) continue
        profiles.push({
          name: entry.name,
          label: typeof entry.label === `string` ? entry.label : entry.name,
          ...(typeof entry.description === `string` && {
            description: entry.description,
          }),
          ...(typeof entry.remote === `boolean` && { remote: entry.remote }),
        })
      }
    }
    return profiles
  }

  async getRunner(id: string): Promise<ElectricAgentsRunner | null> {
    const rows = await this.db
      .select()
      .from(runners)
      .where(and(eq(runners.tenantId, this.tenantId), eq(runners.id, id)))
      .limit(1)
    return rows[0] ? this.rowToRunner(rows[0]) : null
  }

  async listRunners(filter?: {
    ownerPrincipal?: string
  }): Promise<Array<ElectricAgentsRunner>> {
    const conditions = [eq(runners.tenantId, this.tenantId)]
    if (filter?.ownerPrincipal) {
      conditions.push(eq(runners.ownerPrincipal, filter.ownerPrincipal))
    }
    const rows = await this.db
      .select()
      .from(runners)
      .where(and(...conditions))
      .orderBy(desc(runners.createdAt))
    return rows.map((row) => this.rowToRunner(row))
  }

  async heartbeatRunner(
    input: HeartbeatRunnerInput
  ): Promise<ElectricAgentsRunner | null> {
    const now = input.heartbeatAt ?? new Date()
    const leaseExpiresAt =
      input.livenessLeaseExpiresAt ??
      new Date(now.getTime() + (input.leaseMs ?? DEFAULT_RUNNER_LEASE_MS))

    await this.db
      .insert(runnerRuntimeDiagnostics)
      .values({
        tenantId: this.tenantId,
        runnerId: input.runnerId,
        ownerPrincipal: input.ownerPrincipal,
        lastSeenAt: now,
        livenessLeaseExpiresAt: leaseExpiresAt,
        wakeStreamOffset: input.wakeStreamOffset,
        diagnostics: input.diagnostics,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          runnerRuntimeDiagnostics.tenantId,
          runnerRuntimeDiagnostics.runnerId,
        ],
        set: {
          lastSeenAt: now,
          ownerPrincipal: input.ownerPrincipal,
          livenessLeaseExpiresAt: leaseExpiresAt,
          ...(input.wakeStreamOffset !== undefined
            ? { wakeStreamOffset: input.wakeStreamOffset }
            : {}),
          ...(input.diagnostics !== undefined
            ? { diagnostics: input.diagnostics }
            : {}),
          updatedAt: now,
        },
      })

    const runner = await this.getRunner(input.runnerId)
    if (!runner) return null
    return {
      ...runner,
      last_seen_at: now.toISOString(),
      liveness_lease_expires_at: leaseExpiresAt.toISOString(),
      ...(input.wakeStreamOffset !== undefined
        ? { wake_stream_offset: input.wakeStreamOffset }
        : {}),
      ...(input.diagnostics !== undefined
        ? { diagnostics: input.diagnostics }
        : {}),
    }
  }

  async getRunnerDiagnostics(
    runnerId: string
  ): Promise<RunnerRuntimeDiagnostics | null> {
    const rows = await this.db
      .select()
      .from(runnerRuntimeDiagnostics)
      .where(
        and(
          eq(runnerRuntimeDiagnostics.tenantId, this.tenantId),
          eq(runnerRuntimeDiagnostics.runnerId, runnerId)
        )
      )
      .limit(1)
    return rows[0] ? this.rowToRunnerRuntimeDiagnostics(rows[0]) : null
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
      .where(and(eq(runners.tenantId, this.tenantId), eq(runners.id, runnerId)))
      .returning()

    return rows[0] ? this.rowToRunner(rows[0]) : null
  }

  async materializeActiveClaim(
    input: MaterializeActiveClaimInput
  ): Promise<void> {
    const claimedAt = input.claimedAt ?? new Date()
    await this.db.transaction(async (tx) => {
      await tx
        .insert(consumerClaims)
        .values({
          tenantId: this.tenantId,
          consumerId: input.consumerId,
          epoch: input.epoch,
          wakeId: input.wakeId ?? null,
          entityUrl: input.entityUrl,
          streamPath: input.streamPath,
          runnerId: input.runnerId ?? null,
          status: `active`,
          claimedAt,
          leaseExpiresAt: input.leaseExpiresAt ?? null,
          updatedAt: claimedAt,
        })
        .onConflictDoUpdate({
          target: [
            consumerClaims.tenantId,
            consumerClaims.consumerId,
            consumerClaims.epoch,
          ],
          set: {
            wakeId: input.wakeId ?? null,
            entityUrl: input.entityUrl,
            streamPath: input.streamPath,
            runnerId: input.runnerId ?? null,
            status: `active`,
            claimedAt,
            leaseExpiresAt: input.leaseExpiresAt ?? null,
            releasedAt: null,
            updatedAt: claimedAt,
          },
        })

      await tx
        .insert(entityDispatchState)
        .values({
          tenantId: this.tenantId,
          entityUrl: input.entityUrl,
          activeConsumerId: input.consumerId,
          activeRunnerId: input.runnerId ?? null,
          activeEpoch: input.epoch,
          activeClaimedAt: claimedAt,
          activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
          lastClaimedAt: claimedAt,
          updatedAt: claimedAt,
        })
        .onConflictDoUpdate({
          target: [entityDispatchState.tenantId, entityDispatchState.entityUrl],
          set: {
            activeConsumerId: input.consumerId,
            activeRunnerId: input.runnerId ?? null,
            activeEpoch: input.epoch,
            activeClaimedAt: claimedAt,
            activeLeaseExpiresAt: input.leaseExpiresAt ?? null,
            lastClaimedAt: claimedAt,
            updatedAt: claimedAt,
          },
        })
    })
  }

  async materializeHeartbeatClaim(
    input: MaterializeHeartbeatClaimInput
  ): Promise<void> {
    const heartbeatAt = input.heartbeatAt ?? new Date()
    // Only touch leaseExpiresAt when the caller explicitly provides one.
    // The lease was set at materializeActiveClaim time from the upstream
    // lease_ttl_ms and remains the authoritative expiry; heartbeats are
    // alive-pings, not lease extensions.
    await this.db
      .update(consumerClaims)
      .set({
        lastHeartbeatAt: heartbeatAt,
        ...(input.leaseExpiresAt !== undefined
          ? { leaseExpiresAt: input.leaseExpiresAt }
          : {}),
        updatedAt: heartbeatAt,
      })
      .where(
        and(
          eq(consumerClaims.tenantId, this.tenantId),
          eq(consumerClaims.consumerId, input.consumerId),
          eq(consumerClaims.epoch, input.epoch)
        )
      )
  }

  async materializeReleasedClaim(
    input: MaterializeReleasedClaimInput
  ): Promise<{ claim: ConsumerClaim | null; entityCleared: boolean }> {
    const releasedAt = input.releasedAt ?? new Date()
    const rows = await this.db
      .update(consumerClaims)
      .set({
        status: `released`,
        releasedAt,
        ackedStreams: input.ackedStreams ?? null,
        updatedAt: releasedAt,
      })
      .where(
        and(
          eq(consumerClaims.tenantId, this.tenantId),
          eq(consumerClaims.consumerId, input.consumerId),
          eq(consumerClaims.epoch, input.epoch)
        )
      )
      .returning()

    const claim = rows[0] ? this.rowToConsumerClaim(rows[0]) : null
    let entityCleared = false
    if (claim) {
      // entityCleared distinguishes "we were the active dispatch and now it's
      // empty" from "a newer claim was already active for this entity." The
      // WHERE clause matches our (consumerId, epoch) so an evicted-by-newer
      // case correctly returns zero rows.
      const cleared = await this.db
        .update(entityDispatchState)
        .set({
          activeConsumerId: null,
          activeRunnerId: null,
          activeEpoch: null,
          activeClaimedAt: null,
          activeLeaseExpiresAt: null,
          lastReleasedAt: releasedAt,
          lastCompletedAt: releasedAt,
          updatedAt: releasedAt,
        })
        .where(
          and(
            eq(entityDispatchState.tenantId, this.tenantId),
            eq(entityDispatchState.entityUrl, claim.entity_url),
            eq(entityDispatchState.activeConsumerId, input.consumerId),
            eq(entityDispatchState.activeEpoch, input.epoch)
          )
        )
        .returning({ entityUrl: entityDispatchState.entityUrl })
      entityCleared = cleared.length > 0
    }
    return { claim, entityCleared }
  }

  async getActiveClaimsForRunner(
    runnerId: string
  ): Promise<Array<ConsumerClaim>> {
    const rows = await this.db
      .select()
      .from(consumerClaims)
      .where(
        and(
          eq(consumerClaims.tenantId, this.tenantId),
          eq(consumerClaims.runnerId, runnerId),
          eq(consumerClaims.status, `active`)
        )
      )
    return rows.map((row) => this.rowToConsumerClaim(row))
  }

  async getDispatchStatsForRunner(runnerId: string): Promise<{
    entities_with_active_claim: number
    entities_with_outstanding_wake: number
    entities_with_pending_work: number
  }> {
    const rows = await this.db
      .select()
      .from(entityDispatchState)
      .where(
        and(
          eq(entityDispatchState.tenantId, this.tenantId),
          eq(entityDispatchState.activeRunnerId, runnerId)
        )
      )

    let activeClaim = 0
    let outstandingWake = 0
    let pendingWork = 0
    for (const row of rows) {
      if (row.activeConsumerId) activeClaim++
      if (row.outstandingWakeId && !row.activeConsumerId) outstandingWake++
      const pending = row.pendingSourceStreams as Array<unknown> | null
      if (pending && pending.length > 0) pendingWork++
    }

    return {
      entities_with_active_claim: activeClaim,
      entities_with_outstanding_wake: outstandingWake,
      entities_with_pending_work: pendingWork,
    }
  }

  private entityTypeWhere(name: string) {
    return and(
      eq(entityTypes.tenantId, this.tenantId),
      eq(entityTypes.name, name)
    )
  }

  private entityWhere(url: string) {
    return and(eq(entities.tenantId, this.tenantId), eq(entities.url, url))
  }

  private entityBridgeWhere(sourceRef: string) {
    return and(
      eq(entityBridges.tenantId, this.tenantId),
      eq(entityBridges.sourceRef, sourceRef)
    )
  }

  async createEntityType(et: ElectricAgentsEntityType): Promise<void> {
    await this.db
      .insert(entityTypes)
      .values({
        tenantId: this.tenantId,
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
        target: [entityTypes.tenantId, entityTypes.name],
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

  async ensureEntityType(
    et: ElectricAgentsEntityType
  ): Promise<ElectricAgentsEntityType> {
    const existing = await this.getEntityType(et.name)
    if (existing) return existing
    await this.db
      .insert(entityTypes)
      .values({
        tenantId: this.tenantId,
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
      .onConflictDoNothing()
    return (await this.getEntityType(et.name))!
  }

  async getEntityType(name: string): Promise<ElectricAgentsEntityType | null> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .where(this.entityTypeWhere(name))
      .limit(1)
    if (rows.length === 0) return null
    return this.rowToEntityType(rows[0]!)
  }

  async listEntityTypes(): Promise<Array<ElectricAgentsEntityType>> {
    const rows = await this.db
      .select()
      .from(entityTypes)
      .where(eq(entityTypes.tenantId, this.tenantId))
      .orderBy(entityTypes.name)
    return rows.map((row) => this.rowToEntityType(row))
  }

  async deleteEntityType(name: string): Promise<void> {
    await this.db.delete(entityTypes).where(this.entityTypeWhere(name))
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
      .where(this.entityTypeWhere(et.name))
  }

  async createEntity(entity: ElectricAgentsEntity): Promise<number> {
    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx
          .insert(entities)
          .values({
            tenantId: this.tenantId,
            url: entity.url,
            type: entity.type,
            status: entity.status,
            subscriptionId: entity.subscription_id,
            dispatchPolicy: entity.dispatch_policy ?? null,
            writeToken: entity.write_token,
            tags: normalizeTags(entity.tags),
            tagsIndex: buildTagsIndex(entity.tags),
            spawnArgs: entity.spawn_args ?? {},
            sandbox: entity.sandbox ?? null,
            parent: entity.parent ?? null,
            createdBy: entity.created_by ?? null,
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
            tenantId: this.tenantId,
            entityUrl: entity.url,
            pendingSourceStreams: [],
            updatedAt: new Date(),
          })
          .onConflictDoNothing()

        await tx
          .insert(entityLineage)
          .values({
            tenantId: this.tenantId,
            ancestorUrl: entity.url,
            descendantUrl: entity.url,
            depth: 0,
          })
          .onConflictDoNothing()

        if (entity.parent) {
          await tx.execute(sql`
            INSERT INTO ${entityLineage} (
              tenant_id,
              ancestor_url,
              descendant_url,
              depth
            )
            SELECT
              ${this.tenantId},
              ancestor_url,
              ${entity.url},
              depth + 1
            FROM ${entityLineage}
            WHERE tenant_id = ${this.tenantId}
              AND descendant_url = ${entity.parent}
            ON CONFLICT DO NOTHING
          `)
        }

        await tx.execute(sql`
          INSERT INTO ${entityEffectivePermissions} (
            tenant_id,
            entity_url,
            source_entity_url,
            source_grant_id,
            permission,
            subject_kind,
            subject_value,
            expires_at
          )
          SELECT
            ${this.tenantId},
            ${entity.url},
            grants.entity_url,
            grants.id,
            grants.permission,
            grants.subject_kind,
            grants.subject_value,
            grants.expires_at
          FROM ${entityPermissionGrants} grants
          JOIN ${entityLineage} lineage
            ON lineage.tenant_id = grants.tenant_id
           AND lineage.ancestor_url = grants.entity_url
           AND lineage.descendant_url = ${entity.url}
          WHERE grants.tenant_id = ${this.tenantId}
            AND grants.propagation = 'descendants'
            AND (grants.expires_at IS NULL OR grants.expires_at > now())
          ON CONFLICT DO NOTHING
        `)

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
      .where(this.entityWhere(url))
      .limit(1)
    if (rows.length === 0) return null
    return this.rowToEntity(rows[0]!)
  }

  async updateEntityDispatchPolicy(
    url: string,
    dispatchPolicy: DispatchPolicy
  ): Promise<ElectricAgentsEntity | null> {
    const [row] = await this.db
      .update(entities)
      .set({ dispatchPolicy, updatedAt: Date.now() })
      .where(this.entityWhere(url))
      .returning()
    return row ? this.rowToEntity(row) : null
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
    created_by?: string
    readableBy?: {
      principalUrl: string
      principalKind: string
      bypass?: boolean
    }
  }): Promise<{ entities: Array<ElectricAgentsEntity>; total: number }> {
    const conditions = [eq(entities.tenantId, this.tenantId)]
    if (filter?.type) conditions.push(eq(entities.type, filter.type))
    if (filter?.status) conditions.push(eq(entities.status, filter.status))
    if (filter?.parent) conditions.push(eq(entities.parent, filter.parent))
    if (filter?.created_by)
      conditions.push(eq(entities.createdBy, filter.created_by))
    if (filter?.readableBy && !filter.readableBy.bypass) {
      conditions.push(sql`(
        ${entities.createdBy} = ${filter.readableBy.principalUrl}
        OR ${entities.url} IN (
          SELECT ${entityEffectivePermissions.entityUrl}
          FROM ${entityEffectivePermissions}
          WHERE ${entityEffectivePermissions.tenantId} = ${this.tenantId}
            AND ${entityEffectivePermissions.permission} IN ('read', 'manage')
            AND (${entityEffectivePermissions.expiresAt} IS NULL OR ${entityEffectivePermissions.expiresAt} > now())
            AND (
              (${entityEffectivePermissions.subjectKind} = 'principal'
                AND ${entityEffectivePermissions.subjectValue} = ${filter.readableBy.principalUrl})
              OR
              (${entityEffectivePermissions.subjectKind} = 'principal_kind'
                AND ${entityEffectivePermissions.subjectValue} = ${filter.readableBy.principalKind})
            )
        )
      )`)
    }

    const whereClause = and(...conditions)

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

  async createEntityTypePermissionGrant(
    input: CreateEntityTypePermissionGrantInput
  ): Promise<EntityTypePermissionGrant> {
    const [row] = await this.db
      .insert(entityTypePermissionGrants)
      .values({
        tenantId: this.tenantId,
        entityType: input.entityType,
        permission: input.permission,
        subjectKind: input.subjectKind,
        subjectValue: input.subjectValue,
        createdBy: input.createdBy ?? null,
        expiresAt: input.expiresAt ?? null,
      })
      .returning()
    return this.rowToEntityTypePermissionGrant(row!)
  }

  async ensureEntityTypePermissionGrant(
    input: CreateEntityTypePermissionGrantInput
  ): Promise<EntityTypePermissionGrant> {
    const [existing] = await this.db
      .select()
      .from(entityTypePermissionGrants)
      .where(
        and(
          eq(entityTypePermissionGrants.tenantId, this.tenantId),
          eq(entityTypePermissionGrants.entityType, input.entityType),
          eq(entityTypePermissionGrants.permission, input.permission),
          eq(entityTypePermissionGrants.subjectKind, input.subjectKind),
          eq(entityTypePermissionGrants.subjectValue, input.subjectValue),
          input.expiresAt
            ? eq(entityTypePermissionGrants.expiresAt, input.expiresAt)
            : sql`${entityTypePermissionGrants.expiresAt} IS NULL`
        )
      )
      .limit(1)
    if (existing) return this.rowToEntityTypePermissionGrant(existing)

    return await this.createEntityTypePermissionGrant(input)
  }

  async listEntityTypePermissionGrants(
    entityType: string
  ): Promise<Array<EntityTypePermissionGrant>> {
    const rows = await this.db
      .select()
      .from(entityTypePermissionGrants)
      .where(
        and(
          eq(entityTypePermissionGrants.tenantId, this.tenantId),
          eq(entityTypePermissionGrants.entityType, entityType)
        )
      )
      .orderBy(entityTypePermissionGrants.id)
    return rows.map((row) => this.rowToEntityTypePermissionGrant(row))
  }

  async deleteEntityTypePermissionGrant(
    entityType: string,
    grantId: number
  ): Promise<boolean> {
    const rows = await this.db
      .delete(entityTypePermissionGrants)
      .where(
        and(
          eq(entityTypePermissionGrants.tenantId, this.tenantId),
          eq(entityTypePermissionGrants.entityType, entityType),
          eq(entityTypePermissionGrants.id, grantId)
        )
      )
      .returning({ id: entityTypePermissionGrants.id })
    return rows.length > 0
  }

  async hasEntityTypePermission(
    entityType: string,
    permission: EntityTypePermission,
    subject: { principalUrl: string; principalKind: string }
  ): Promise<boolean> {
    const permissions = [permission, `manage`] as const
    const rows = await this.db
      .select({ id: entityTypePermissionGrants.id })
      .from(entityTypePermissionGrants)
      .where(
        and(
          eq(entityTypePermissionGrants.tenantId, this.tenantId),
          eq(entityTypePermissionGrants.entityType, entityType),
          inArray(entityTypePermissionGrants.permission, [...permissions]),
          sql`(${entityTypePermissionGrants.expiresAt} IS NULL OR ${entityTypePermissionGrants.expiresAt} > now())`,
          sql`(
            (${entityTypePermissionGrants.subjectKind} = 'principal'
              AND ${entityTypePermissionGrants.subjectValue} = ${subject.principalUrl})
            OR
            (${entityTypePermissionGrants.subjectKind} = 'principal_kind'
              AND ${entityTypePermissionGrants.subjectValue} = ${subject.principalKind})
          )`
        )
      )
      .limit(1)
    return rows.length > 0
  }

  async createEntityPermissionGrant(
    input: CreateEntityPermissionGrantInput
  ): Promise<EntityPermissionGrant> {
    return await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(entityPermissionGrants)
        .values({
          tenantId: this.tenantId,
          entityUrl: input.entityUrl,
          permission: input.permission,
          subjectKind: input.subjectKind,
          subjectValue: input.subjectValue,
          propagation: input.propagation ?? `self`,
          copyToChildren: input.copyToChildren ?? false,
          createdBy: input.createdBy ?? null,
          expiresAt: input.expiresAt ?? null,
        })
        .returning()
      await this.materializeEntityPermissionGrant(tx, row!)
      return this.rowToEntityPermissionGrant(row!)
    })
  }

  async listEntityPermissionGrants(
    entityUrl: string
  ): Promise<Array<EntityPermissionGrant>> {
    const rows = await this.db
      .select()
      .from(entityPermissionGrants)
      .where(
        and(
          eq(entityPermissionGrants.tenantId, this.tenantId),
          eq(entityPermissionGrants.entityUrl, entityUrl)
        )
      )
      .orderBy(entityPermissionGrants.id)
    return rows.map((row) => this.rowToEntityPermissionGrant(row))
  }

  async deleteEntityPermissionGrant(
    entityUrl: string,
    grantId: number
  ): Promise<boolean> {
    return await this.db.transaction(async (tx) => {
      await tx
        .delete(entityEffectivePermissions)
        .where(
          and(
            eq(entityEffectivePermissions.tenantId, this.tenantId),
            eq(entityEffectivePermissions.sourceGrantId, grantId)
          )
        )
      const rows = await tx
        .delete(entityPermissionGrants)
        .where(
          and(
            eq(entityPermissionGrants.tenantId, this.tenantId),
            eq(entityPermissionGrants.entityUrl, entityUrl),
            eq(entityPermissionGrants.id, grantId)
          )
        )
        .returning({ id: entityPermissionGrants.id })
      return rows.length > 0
    })
  }

  async copyEntityPermissionGrantsForSpawn(
    parentEntityUrl: string,
    childEntityUrl: string,
    createdBy?: string
  ): Promise<Array<EntityPermissionGrant>> {
    const parentGrants = await this.db
      .select()
      .from(entityPermissionGrants)
      .where(
        and(
          eq(entityPermissionGrants.tenantId, this.tenantId),
          eq(entityPermissionGrants.entityUrl, parentEntityUrl),
          eq(entityPermissionGrants.copyToChildren, true),
          sql`(${entityPermissionGrants.expiresAt} IS NULL OR ${entityPermissionGrants.expiresAt} > now())`
        )
      )

    const copied: Array<EntityPermissionGrant> = []
    for (const grant of parentGrants) {
      copied.push(
        await this.createEntityPermissionGrant({
          entityUrl: childEntityUrl,
          permission: grant.permission as EntityPermission,
          subjectKind: grant.subjectKind as PermissionSubjectKind,
          subjectValue: grant.subjectValue,
          propagation: `self`,
          copyToChildren: grant.copyToChildren,
          createdBy,
          expiresAt: grant.expiresAt ?? undefined,
        })
      )
    }
    return copied
  }

  async hasEntityPermission(
    entityUrl: string,
    permission: EntityPermission,
    subject: { principalUrl: string; principalKind: string }
  ): Promise<boolean> {
    const permissions = [permission, `manage`] as const
    const rows = await this.db
      .select({ id: entityEffectivePermissions.id })
      .from(entityEffectivePermissions)
      .where(
        and(
          eq(entityEffectivePermissions.tenantId, this.tenantId),
          eq(entityEffectivePermissions.entityUrl, entityUrl),
          inArray(entityEffectivePermissions.permission, [...permissions]),
          sql`(${entityEffectivePermissions.expiresAt} IS NULL OR ${entityEffectivePermissions.expiresAt} > now())`,
          sql`(
            (${entityEffectivePermissions.subjectKind} = 'principal'
              AND ${entityEffectivePermissions.subjectValue} = ${subject.principalUrl})
            OR
            (${entityEffectivePermissions.subjectKind} = 'principal_kind'
              AND ${entityEffectivePermissions.subjectValue} = ${subject.principalKind})
          )`
        )
      )
      .limit(1)
    return rows.length > 0
  }

  async replaceSharedStateLink(
    ownerEntityUrl: string,
    manifestKey: string,
    sharedStateId?: string
  ): Promise<void> {
    await this.db
      .delete(sharedStateLinks)
      .where(
        and(
          eq(sharedStateLinks.tenantId, this.tenantId),
          eq(sharedStateLinks.ownerEntityUrl, ownerEntityUrl),
          eq(sharedStateLinks.manifestKey, manifestKey)
        )
      )

    if (!sharedStateId) return

    await this.db
      .insert(sharedStateLinks)
      .values({
        tenantId: this.tenantId,
        ownerEntityUrl,
        manifestKey,
        sharedStateId,
      })
      .onConflictDoUpdate({
        target: [
          sharedStateLinks.tenantId,
          sharedStateLinks.ownerEntityUrl,
          sharedStateLinks.manifestKey,
        ],
        set: {
          sharedStateId,
          updatedAt: new Date(),
        },
      })
  }

  async listSharedStateLinkedEntityUrls(
    sharedStateId: string
  ): Promise<Array<string>> {
    const rows = await this.db
      .selectDistinct({ ownerEntityUrl: sharedStateLinks.ownerEntityUrl })
      .from(sharedStateLinks)
      .where(
        and(
          eq(sharedStateLinks.tenantId, this.tenantId),
          eq(sharedStateLinks.sharedStateId, sharedStateId)
        )
      )
    return rows.map((row) => row.ownerEntityUrl)
  }

  async pruneExpiredPermissionGrants(
    now: Date = new Date(),
    options: { force?: boolean } = {}
  ): Promise<void> {
    if (this.permissionPrunePromise) return await this.permissionPrunePromise

    const startedAt = Date.now()
    if (
      !options.force &&
      startedAt - this.lastPermissionPruneStartedAt <
        PERMISSION_PRUNE_INTERVAL_MS
    ) {
      return
    }

    this.lastPermissionPruneStartedAt = startedAt
    const promise = this.pruneExpiredPermissionGrantsNow(now)
    this.permissionPrunePromise = promise
    try {
      await promise
    } catch (error) {
      this.lastPermissionPruneStartedAt = 0
      throw error
    } finally {
      if (this.permissionPrunePromise === promise) {
        this.permissionPrunePromise = null
      }
    }
  }

  private async pruneExpiredPermissionGrantsNow(now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const expiredEntityGrantIds = await tx
        .select({ id: entityPermissionGrants.id })
        .from(entityPermissionGrants)
        .where(
          and(
            eq(entityPermissionGrants.tenantId, this.tenantId),
            sql`${entityPermissionGrants.expiresAt} IS NOT NULL`,
            lt(entityPermissionGrants.expiresAt, now)
          )
        )
      const ids = expiredEntityGrantIds.map((row) => row.id)
      if (ids.length > 0) {
        await tx
          .delete(entityEffectivePermissions)
          .where(
            and(
              eq(entityEffectivePermissions.tenantId, this.tenantId),
              inArray(entityEffectivePermissions.sourceGrantId, ids)
            )
          )
        await tx
          .delete(entityPermissionGrants)
          .where(
            and(
              eq(entityPermissionGrants.tenantId, this.tenantId),
              inArray(entityPermissionGrants.id, ids)
            )
          )
      }

      await tx
        .delete(entityEffectivePermissions)
        .where(
          and(
            eq(entityEffectivePermissions.tenantId, this.tenantId),
            sql`${entityEffectivePermissions.expiresAt} IS NOT NULL`,
            lt(entityEffectivePermissions.expiresAt, now)
          )
        )
      await tx
        .delete(entityTypePermissionGrants)
        .where(
          and(
            eq(entityTypePermissionGrants.tenantId, this.tenantId),
            sql`${entityTypePermissionGrants.expiresAt} IS NOT NULL`,
            lt(entityTypePermissionGrants.expiresAt, now)
          )
        )
    })
  }

  private async materializeEntityPermissionGrant(
    tx: RegistryTransaction,
    grant: typeof entityPermissionGrants.$inferSelect
  ): Promise<void> {
    await tx
      .delete(entityEffectivePermissions)
      .where(
        and(
          eq(entityEffectivePermissions.tenantId, this.tenantId),
          eq(entityEffectivePermissions.sourceGrantId, grant.id)
        )
      )

    if (grant.propagation === `descendants`) {
      await tx.execute(sql`
        INSERT INTO ${entityEffectivePermissions} (
          tenant_id,
          entity_url,
          source_entity_url,
          source_grant_id,
          permission,
          subject_kind,
          subject_value,
          expires_at
        )
        SELECT
          ${this.tenantId},
          descendant_url,
          ${grant.entityUrl},
          ${grant.id},
          ${grant.permission},
          ${grant.subjectKind},
          ${grant.subjectValue},
          ${grant.expiresAt}
        FROM ${entityLineage}
        WHERE tenant_id = ${this.tenantId}
          AND ancestor_url = ${grant.entityUrl}
        ON CONFLICT DO NOTHING
      `)
      return
    }

    await tx
      .insert(entityEffectivePermissions)
      .values({
        tenantId: this.tenantId,
        entityUrl: grant.entityUrl,
        sourceEntityUrl: grant.entityUrl,
        sourceGrantId: grant.id,
        permission: grant.permission,
        subjectKind: grant.subjectKind,
        subjectValue: grant.subjectValue,
        expiresAt: grant.expiresAt,
      })
      .onConflictDoNothing()
  }

  async updateStatus(entityUrl: string, status: EntityStatus): Promise<void> {
    const whereClause = isTerminalEntityStatus(status)
      ? this.entityWhere(entityUrl)
      : and(
          this.entityWhere(entityUrl),
          ne(entities.status, `stopped`),
          ne(entities.status, `killed`)
        )

    await this.db
      .update(entities)
      .set({ status, updatedAt: Date.now() })
      .where(whereClause)
  }

  async updateStatusWithTxid(
    entityUrl: string,
    status: EntityStatus
  ): Promise<number | null> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(entities)
        .set({ status, updatedAt: Date.now() })
        .where(
          and(
            this.entityWhere(entityUrl),
            ne(entities.status, `stopped`),
            ne(entities.status, `killed`)
          )
        )
        .returning({
          txid: sql<string>`pg_current_xact_id()::xid::text`,
        })
      return rows[0] ? parseInt(rows[0].txid) : null
    })
  }

  async touchEntityWithTxid(entityUrl: string): Promise<number | null> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(entities)
        .set({ updatedAt: Date.now() })
        .where(
          and(
            eq(entities.url, entityUrl),
            ne(entities.status, `stopped`),
            ne(entities.status, `killed`)
          )
        )
        .returning({
          txid: sql<string>`pg_current_xact_id()::xid::text`,
        })
      return rows[0] ? parseInt(rows[0].txid) : null
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
        .where(this.entityWhere(url))
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
        .where(this.entityWhere(url))

      await tx.insert(tagStreamOutbox).values({
        tenantId: this.tenantId,
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
    principalUrl: string
    principalKind: string
  }): Promise<EntityBridgeRow> {
    await this.db
      .insert(entityBridges)
      .values({
        tenantId: this.tenantId,
        sourceRef: row.sourceRef,
        tags: normalizeTags(row.tags),
        streamUrl: row.streamUrl,
        principalUrl: row.principalUrl,
        principalKind: row.principalKind,
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
      .where(this.entityBridgeWhere(sourceRef))
      .limit(1)
    return rows[0] ? this.rowToEntityBridge(rows[0]) : null
  }

  async listEntityBridges(
    tenantId: string | null = this.tenantId
  ): Promise<Array<EntityBridgeRow>> {
    const rows =
      tenantId === null
        ? await this.db.select().from(entityBridges)
        : await this.db
            .select()
            .from(entityBridges)
            .where(eq(entityBridges.tenantId, tenantId))
    return rows.map((row) => this.rowToEntityBridge(row))
  }

  async listStaleEntityBridges(before: Date): Promise<Array<EntityBridgeRow>> {
    const rows = await this.db
      .select()
      .from(entityBridges)
      .where(
        and(
          eq(entityBridges.tenantId, this.tenantId),
          lt(entityBridges.lastObserverActivityAt, before)
        )
      )
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
          eq(entityManifestSources.tenantId, this.tenantId),
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
        tenantId: this.tenantId,
        ownerEntityUrl,
        manifestKey,
        sourceRef,
      })
      .onConflictDoUpdate({
        target: [
          entityManifestSources.tenantId,
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
    await this.db
      .delete(entityManifestSources)
      .where(eq(entityManifestSources.tenantId, this.tenantId))
  }

  async listReferencedEntitySourceRefs(): Promise<Array<string>> {
    const rows = await this.db
      .selectDistinct({ sourceRef: entityManifestSources.sourceRef })
      .from(entityManifestSources)
      .where(eq(entityManifestSources.tenantId, this.tenantId))
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
      .where(this.entityBridgeWhere(sourceRef))
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
      .where(this.entityBridgeWhere(sourceRef))
  }

  async clearEntityBridgeCursor(sourceRef: string): Promise<void> {
    await this.db
      .update(entityBridges)
      .set({
        shapeHandle: null,
        shapeOffset: null,
        updatedAt: new Date(),
      })
      .where(this.entityBridgeWhere(sourceRef))
  }

  async deleteEntityBridge(sourceRef: string): Promise<void> {
    await this.db.delete(entityBridges).where(this.entityBridgeWhere(sourceRef))
  }

  // The 30-second window is the claim lease TTL: if a worker crashes mid-
  // publish, its claim is reclaimable by another worker after 30s. Pairs
  // with DRAIN_INTERVAL_MS=500 — short enough that recovery is fast, long
  // enough that a healthy in-flight publish won't be stolen.
  async claimTagOutboxRows(
    workerId: string,
    limit = 25,
    tenantId: string | null = this.tenantId
  ): Promise<Array<TagStreamOutboxRow>> {
    const tenantFilter =
      tenantId === null
        ? sql``
        : sql`AND ${tagStreamOutbox.tenantId} = ${tenantId}`
    const claimed = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id
          FROM ${tagStreamOutbox}
         WHERE ${tagStreamOutbox.deadLetteredAt} IS NULL
           ${tenantFilter}
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
        tenant_id AS "tenantId",
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
        tenantId: string
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
    maxAttempts: number,
    tenantId: string | null = this.tenantId
  ): Promise<{ attemptCount: number; deadLettered: boolean }> {
    const tenantFilter =
      tenantId === null
        ? sql``
        : sql`AND ${tagStreamOutbox.tenantId} = ${tenantId}`
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
         ${tenantFilter}
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

  async deleteTagOutboxRow(
    id: number,
    tenantId: string | null = this.tenantId
  ): Promise<void> {
    const conditions = [eq(tagStreamOutbox.id, id)]
    if (tenantId !== null) {
      conditions.unshift(eq(tagStreamOutbox.tenantId, tenantId))
    }
    await this.db.delete(tagStreamOutbox).where(and(...conditions))
  }

  async releaseTagOutboxClaims(
    workerId: string,
    tenantId: string | null = this.tenantId
  ): Promise<void> {
    const conditions = [
      eq(tagStreamOutbox.claimedBy, workerId),
      sql`${tagStreamOutbox.deadLetteredAt} IS NULL`,
    ]
    if (tenantId !== null) {
      conditions.unshift(eq(tagStreamOutbox.tenantId, tenantId))
    }
    await this.db
      .update(tagStreamOutbox)
      .set({
        claimedBy: null,
        claimedAt: null,
      })
      .where(and(...conditions))
  }

  async deleteEntity(url: string): Promise<void> {
    await this.db.delete(entities).where(this.entityWhere(url))
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
        (row.defaultDispatchPolicy as ElectricAgentsEntityType[`default_dispatch_policy`]) ??
        undefined,
      revision: row.revision,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }
  }

  private rowToEntityTypePermissionGrant(
    row: typeof entityTypePermissionGrants.$inferSelect
  ): EntityTypePermissionGrant {
    return {
      id: row.id,
      entity_type: row.entityType,
      permission: row.permission as EntityTypePermission,
      subject_kind: row.subjectKind as PermissionSubjectKind,
      subject_value: row.subjectValue,
      created_by: row.createdBy ?? undefined,
      expires_at: row.expiresAt?.toISOString(),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }

  private rowToEntityPermissionGrant(
    row: typeof entityPermissionGrants.$inferSelect
  ): EntityPermissionGrant {
    return {
      id: row.id,
      entity_url: row.entityUrl,
      permission: row.permission as EntityPermission,
      subject_kind: row.subjectKind as PermissionSubjectKind,
      subject_value: row.subjectValue,
      propagation: row.propagation as EntityPermissionPropagation,
      copy_to_children: row.copyToChildren,
      created_by: row.createdBy ?? undefined,
      expires_at: row.expiresAt?.toISOString(),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
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
        (row.dispatchPolicy as ElectricAgentsEntity[`dispatch_policy`]) ??
        undefined,
      write_token: row.writeToken,
      tags: (row.tags as EntityTags | null | undefined) ?? {},
      spawn_args: row.spawnArgs as Record<string, unknown> | undefined,
      sandbox:
        (row.sandbox as ElectricAgentsEntity[`sandbox`] | null) ?? undefined,
      parent: row.parent ?? undefined,
      created_by: row.createdBy ?? undefined,
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
      tenantId: row.tenantId,
      sourceRef: row.sourceRef,
      tags: (row.tags as EntityTags | null | undefined) ?? {},
      streamUrl: row.streamUrl,
      principalUrl: row.principalUrl ?? undefined,
      principalKind: row.principalKind ?? undefined,
      shapeHandle: row.shapeHandle ?? undefined,
      shapeOffset: row.shapeOffset ?? undefined,
      lastObserverActivityAt: row.lastObserverActivityAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private rowToTagStreamOutbox(row: {
    id: number
    tenantId: string
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
      tenantId: row.tenantId,
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

  private rowToRunner(row: typeof runners.$inferSelect): ElectricAgentsRunner {
    return {
      id: row.id,
      owner_principal: row.ownerPrincipal,
      label: row.label,
      kind: assertRunnerKind(row.kind),
      admin_status: assertRunnerAdminStatus(row.adminStatus),
      wake_stream: row.wakeStream,
      sandbox_profiles:
        (row.sandboxProfiles as Array<{
          name: string
          label: string
          description?: string
          remote?: boolean
        }> | null) ?? [],
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    }
  }

  private rowToRunnerRuntimeDiagnostics(
    row: typeof runnerRuntimeDiagnostics.$inferSelect
  ): RunnerRuntimeDiagnostics {
    return {
      runner_id: row.runnerId,
      owner_principal: row.ownerPrincipal,
      wake_stream_offset: row.wakeStreamOffset ?? undefined,
      last_seen_at: row.lastSeenAt.toISOString(),
      liveness_lease_expires_at: row.livenessLeaseExpiresAt.toISOString(),
      diagnostics: (row.diagnostics as Record<string, unknown>) ?? undefined,
      updated_at: row.updatedAt.toISOString(),
    }
  }

  private rowToConsumerClaim(
    row: typeof consumerClaims.$inferSelect
  ): ConsumerClaim {
    return {
      consumer_id: row.consumerId,
      epoch: row.epoch,
      wake_id: row.wakeId ?? undefined,
      entity_url: row.entityUrl,
      stream_path: row.streamPath,
      runner_id: row.runnerId ?? undefined,
      status: row.status as ConsumerClaim[`status`],
      claimed_at: row.claimedAt.toISOString(),
      last_heartbeat_at: row.lastHeartbeatAt?.toISOString(),
      lease_expires_at: row.leaseExpiresAt?.toISOString(),
      released_at: row.releasedAt?.toISOString(),
      acked_streams:
        (row.ackedStreams as Array<SourceStreamOffset> | null | undefined) ??
        undefined,
      updated_at: row.updatedAt.toISOString(),
    }
  }
}
