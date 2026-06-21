import { snakeCamelMapper } from '@electric-sql/client'
import {
  and as dbAnd,
  createCollection,
  createEffect,
  createOptimisticAction,
  eq as dbEq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@tanstack/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { wakeRegistrations } from './db/schema.js'
import { serverLog } from './utils/log.js'
import { electricUrlWithPath } from './utils/electric-url.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import type { DrizzleDB } from './db/index.js'
import type { Collection } from '@tanstack/db'

class WakeRegistrationConflictError extends Error {
  constructor(readonly row: WakeRegistrationCollectionRow) {
    super(`Wake registration insert conflicted with an existing row`)
    this.name = `WakeRegistrationConflictError`
  }
}

class WakeRegistrationStaleError extends Error {
  constructor() {
    super(`Wake registration row was no longer present`)
    this.name = `WakeRegistrationStaleError`
  }
}

export interface WakeRegistration {
  tenantId?: string
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
  oneShot: boolean
  includeResponse?: boolean
  manifestKey?: string
}

export interface WakeEvalResult {
  tenantId: string
  subscriberUrl: string
  registrationDbId: number
  sourceEventKey: string
  wakeMessage: {
    source: string
    timeout: boolean
    changes: Array<{
      collection: string
      kind: `insert` | `update` | `delete`
      key: string
      value?: unknown
      oldValue?: unknown
      from?: string
      from_principal?: string
      from_agent?: string
      payload?: unknown
      timestamp?: string
      message_type?: string
    }>
  }
  runFinishedStatus?: `completed` | `failed`
  includeResponse?: boolean
}

export type WakeTimeoutCallback = (result: WakeEvalResult) => void
export type WakeDebounceCallback = (result: WakeEvalResult) => void

export interface WakeRegistrationCollectionRow {
  id: number
  tenantId: string
  subscriberUrl: string
  sourceUrl: string
  condition: WakeRegistration[`condition`]
  debounceMs: number
  timeoutMs: number
  oneShot: boolean
  timeoutConsumed: boolean
  includeResponse: boolean
  manifestKey: string | null
  createdAt: Date
}

type WakeRegistryMode = `unstarted` | `local-test` | `electric`

type PersistInsertResult = {
  txid: number
  row: WakeRegistrationCollectionRow
}

type DeleteRowsInput = {
  rows: Array<WakeRegistrationCollectionRow>
  persist:
    | {
        kind: `manifestKey`
        tenantId: string
        subscriberUrl: string
        manifestKey: string
      }
    | { kind: `subscriber`; tenantId: string; subscriberUrl: string }
    | { kind: `source`; tenantId: string; sourceUrl: string }
    | {
        kind: `subscriberAndSource`
        tenantId: string
        subscriberUrl: string
        sourceUrl: string
      }
    | { kind: `oneShot` }
}

function wakeSourceEventId(event: Record<string, unknown>): string {
  const headers =
    typeof event.headers === `object` && event.headers !== null
      ? (event.headers as Record<string, unknown>)
      : undefined
  const offset = headers?.offset
  if (typeof offset === `string` && offset.length > 0) {
    return offset
  }

  const operation = headers?.operation
  const key = event.key
  if (typeof operation === `string` && typeof key === `string`) {
    return `${operation}:${key}`
  }
  if (typeof key === `string`) {
    return key
  }
  return crypto.randomUUID()
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}

let nextWakeRegistryCollectionInstance = 1

export class WakeRegistry {
  private db: DrizzleDB
  private registrationsCollection: Collection<
    WakeRegistrationCollectionRow,
    number,
    any
  > | null = null
  private mode: WakeRegistryMode = `unstarted`
  private nextLocalId = 1
  private registrationsEffect: { dispose(): Promise<void> } | null = null
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private debounceBuffers = new Map<
    string,
    Array<WakeEvalResult[`wakeMessage`][`changes`][number]>
  >()
  private debounceRunStatus = new Map<string, `completed` | `failed`>()
  private timeoutTimers = new Map<string, NodeJS.Timeout>()
  private timeoutDelivered = new Set<number>()
  private timeoutCallbacks = new Map<string, WakeTimeoutCallback>()
  private debounceCallbacks = new Map<string, WakeDebounceCallback>()
  private readonly collectionInstance = nextWakeRegistryCollectionInstance++

  constructor(
    db: DrizzleDB,
    readonly tenantId: string | null = DEFAULT_TENANT_ID
  ) {
    this.db = db
  }

  requireCollection(): Collection<WakeRegistrationCollectionRow, number, any> {
    if (!this.registrationsCollection) {
      throw new Error(`WakeRegistry has not been started`)
    }
    return this.registrationsCollection
  }

  async startLocalForTests(): Promise<void> {
    if (this.registrationsCollection) return
    this.mode = `local-test`
    this.registrationsCollection = createCollection(
      localOnlyCollectionOptions<WakeRegistrationCollectionRow, number>({
        id: `wake-registrations-local:${this.tenantId ?? `all`}`,
        getKey: (row) => row.id,
        initialData: [],
      })
    )
    await this.requireCollection().preload()
    this.startRegistrationEffect()
  }

  private startRegistrationEffect(): void {
    if (this.registrationsEffect) return
    const collection = this.requireCollection()
    this.registrationsEffect = createEffect<
      WakeRegistrationCollectionRow,
      number
    >({
      query: (q) => q.from({ reg: collection }),
      skipInitial: false,
      onEnter: ({ value }) => {
        this.syncTimeoutTimer(value)
      },
      onUpdate: ({ value }) => {
        this.syncTimeoutTimer(value)
      },
      onExit: ({ value }) => {
        this.clearRegistrationState(value)
        this.timeoutDelivered.delete(value.id)
      },
    })
  }

  private allocateLocalId(): number {
    return this.nextLocalId++
  }

  private normalizeRegistration(
    reg: WakeRegistration,
    tenantId: string,
    id: number
  ): WakeRegistrationCollectionRow {
    return {
      id,
      tenantId,
      subscriberUrl: reg.subscriberUrl,
      sourceUrl: reg.sourceUrl,
      condition: reg.condition,
      debounceMs: reg.debounceMs ?? 0,
      timeoutMs: reg.timeoutMs ?? 0,
      oneShot: reg.oneShot,
      timeoutConsumed: false,
      includeResponse: reg.includeResponse !== false,
      manifestKey: reg.manifestKey ?? ``,
      createdAt: new Date(),
    }
  }

  private normalizeQueriedRows(
    rows: Array<
      WakeRegistrationCollectionRow | { reg: WakeRegistrationCollectionRow }
    >
  ): Array<WakeRegistrationCollectionRow> {
    return rows.map(
      (row) =>
        ((row as { reg?: WakeRegistrationCollectionRow }).reg ??
          row) as WakeRegistrationCollectionRow
    )
  }

  private async rowsByPredicate(
    predicate: (row: WakeRegistrationCollectionRow) => boolean
  ): Promise<Array<WakeRegistrationCollectionRow>> {
    const rows = await queryOnce((q) =>
      q.from({ reg: this.requireCollection() })
    )
    return this.normalizeQueriedRows(
      rows as Array<
        WakeRegistrationCollectionRow | { reg: WakeRegistrationCollectionRow }
      >
    ).filter(predicate)
  }

  private async rowsForSource(
    tenantId: string,
    sourceUrl: string
  ): Promise<Array<WakeRegistrationCollectionRow>> {
    const rows = await queryOnce((q) =>
      q
        .from({ reg: this.requireCollection() })
        .where(({ reg }) =>
          dbAnd(dbEq(reg.tenantId, tenantId), dbEq(reg.sourceUrl, sourceUrl))
        )
    )
    return this.normalizeQueriedRows(
      rows as Array<
        WakeRegistrationCollectionRow | { reg: WakeRegistrationCollectionRow }
      >
    )
  }

  private registerAction =
    createOptimisticAction<WakeRegistrationCollectionRow>({
      onMutate: (row) => {
        this.requireCollection().insert(row)
      },
      mutationFn: async (row, { transaction }) => {
        if (this.mode === `local-test`) {
          this.requireCollection().utils.acceptMutations(transaction)
          return
        }
        if (this.mode === `electric`) {
          const result = await this.persistInsert(row)
          try {
            await this.requireCollection().utils.awaitTxId(result.txid, 10_000)
          } catch (error) {
            if (
              error instanceof Error &&
              error.name === `TimeoutWaitingForTxIdError`
            ) {
              this.requireCollection().utils.acceptMutations(transaction)
              return { txid: result.txid }
            }
            throw error
          }
          return { txid: result.txid }
        }
        throw new Error(`WakeRegistry registerAction called before startup`)
      },
    })

  private deleteRowsAction = createOptimisticAction<DeleteRowsInput>({
    onMutate: ({ rows }) => {
      const collection = this.requireCollection()
      for (const row of rows) {
        this.clearRegistrationState(row)
        this.timeoutDelivered.delete(row.id)
        collection.delete(row.id)
      }
    },
    mutationFn: async (input, { transaction }) => {
      if (this.mode === `local-test`) {
        this.requireCollection().utils.acceptMutations(transaction)
        return
      }
      if (this.mode === `electric`) {
        const txid = await this.persistDeleteRows(input)
        if (txid === undefined) {
          this.requireCollection().utils.acceptMutations(transaction)
          return
        }
        try {
          await this.requireCollection().utils.awaitTxId(txid, 10_000)
        } catch (error) {
          if (
            error instanceof Error &&
            error.name === `TimeoutWaitingForTxIdError`
          ) {
            this.requireCollection().utils.acceptMutations(transaction)
            return { txid }
          }
          throw error
        }
        return { txid }
      }
      throw new Error(`WakeRegistry deleteRowsAction called before startup`)
    },
  })

  private markTimeoutConsumedAction = createOptimisticAction<{
    row: WakeRegistrationCollectionRow
  }>({
    onMutate: ({ row }) => {
      this.requireCollection().update(row.id, (draft) => {
        draft.timeoutConsumed = true
      })
    },
    mutationFn: async ({ row }, { transaction }) => {
      if (this.mode === `local-test`) {
        this.requireCollection().utils.acceptMutations(transaction)
        return
      }
      if (this.mode === `electric`) {
        const txid = await this.persistTimeoutConsumed({
          ...row,
          timeoutConsumed: true,
        })
        if (txid === undefined) {
          throw new WakeRegistrationStaleError()
        }
        await this.requireCollection().utils.awaitTxId(txid, 10_000)
        return { txid }
      }
      throw new Error(
        `WakeRegistry markTimeoutConsumedAction called before startup`
      )
    },
  })

  setTimeoutCallback(cb: WakeTimeoutCallback, tenantId?: string): void {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    this.timeoutCallbacks.set(resolvedTenantId, cb)
    this.syncTenantTimeoutTimers(resolvedTenantId)
    void this.syncTenantCollectionTimeoutTimers(resolvedTenantId)
  }

  setDebounceCallback(cb: WakeDebounceCallback, tenantId?: string): void {
    this.debounceCallbacks.set(this.resolveTenantId(tenantId), cb)
  }

  private resolveTenantId(tenantId?: string): string {
    if (tenantId) return tenantId
    if (this.tenantId) return this.tenantId
    throw new Error(`WakeRegistry tenantId is required in shared mode`)
  }

  private registrationKey(reg: WakeRegistrationCollectionRow): string {
    return [
      reg.tenantId,
      reg.subscriberUrl,
      reg.sourceUrl,
      reg.manifestKey ?? ``,
      reg.oneShot ? `1` : `0`,
      reg.debounceMs ?? ``,
      reg.timeoutMs ?? ``,
      JSON.stringify(reg.condition),
      reg.includeResponse === false ? `0` : `1`,
    ].join(`:`)
  }

  private deliverTimeout(result: WakeEvalResult): boolean {
    const callback = this.timeoutCallbacks.get(result.tenantId)
    if (!callback) return false
    callback(result)
    return true
  }

  private deliverDebounce(result: WakeEvalResult): void {
    this.debounceCallbacks.get(result.tenantId)?.(result)
  }

  async startSync(electricUrl: string, electricSecret?: string): Promise<void> {
    if (this.registrationsCollection) {
      await this.registrationsCollection.preload()
      this.startRegistrationEffect()
      return
    }

    this.mode = `electric`
    this.registrationsCollection = createCollection(
      electricCollectionOptions({
        id: `wake-registrations:${this.tenantId ?? `all`}:${electricUrlWithPath(electricUrl, `/v1/shape`).toString()}:${this.collectionInstance}`,
        getKey: (row: any) => row.id as number,
        shapeOptions: {
          url: electricUrlWithPath(electricUrl, `/v1/shape`).toString(),
          params: {
            table: `wake_registrations`,
            ...(this.tenantId
              ? { where: `tenant_id = ${sqlStringLiteral(this.tenantId)}` }
              : {}),
            ...(electricSecret ? { secret: electricSecret } : {}),
            columns: [
              `id`,
              `tenant_id`,
              `subscriber_url`,
              `source_url`,
              `condition`,
              `debounce_ms`,
              `timeout_ms`,
              `one_shot`,
              `timeout_consumed`,
              `include_response`,
              `manifest_key`,
              `created_at`,
            ],
            replica: `full`,
          },
          parser: {
            timestamptz: (value: string) => new Date(value),
          },
          columnMapper: snakeCamelMapper(),
        },
      } as any)
    ) as any

    try {
      await this.requireCollection().preload()
    } catch (error) {
      const collection = this.registrationsCollection
      this.registrationsCollection = null
      this.mode = `unstarted`
      await collection?.cleanup?.()
      throw error
    }
    this.startRegistrationEffect()
  }

  async stopSync(): Promise<void> {
    const collection = this.registrationsCollection
    await this.registrationsEffect?.dispose()
    this.registrationsEffect = null
    this.registrationsCollection = null
    this.mode = `unstarted`
    this.resetRuntimeState()
    await collection?.cleanup?.()
  }

  private resetRuntimeState(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()
    this.debounceBuffers.clear()
    this.debounceRunStatus.clear()

    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer)
    }
    this.timeoutTimers.clear()
    this.timeoutDelivered.clear()
  }

  private async allocateRegistrationId(): Promise<number> {
    if (this.mode !== `electric`) {
      return this.allocateLocalId()
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const id = await this.allocateRuntimeId()
      const existing = await this.rowsByPredicate((row) => row.id === id)
      if (existing.length === 0) return id
    }

    throw new Error(`Failed to allocate unused wake registration id`)
  }

  private async allocateRuntimeId(): Promise<number> {
    const rows = await this.db.execute(
      sql<{
        id: string
      }>`select nextval('wake_registrations_id_seq')::text as id`
    )
    const value = Array.isArray(rows)
      ? rows[0]?.id
      : ((rows as any).rows?.[0]?.id ?? (rows as any)[0]?.id)
    const id = Number(value)
    if (!Number.isInteger(id)) {
      throw new Error(`Failed to allocate wake registration id`)
    }
    return id
  }

  private async persistInsert(
    row: WakeRegistrationCollectionRow
  ): Promise<PersistInsertResult> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(wakeRegistrations)
        .values({
          id: row.id,
          tenantId: row.tenantId,
          subscriberUrl: row.subscriberUrl,
          sourceUrl: row.sourceUrl,
          condition: row.condition,
          debounceMs: row.debounceMs,
          timeoutMs: row.timeoutMs,
          oneShot: row.oneShot,
          timeoutConsumed: row.timeoutConsumed,
          includeResponse: row.includeResponse,
          manifestKey: row.manifestKey ?? ``,
          createdAt: row.createdAt,
        })
        .onConflictDoUpdate({
          target: [
            wakeRegistrations.tenantId,
            wakeRegistrations.subscriberUrl,
            wakeRegistrations.sourceUrl,
            wakeRegistrations.oneShot,
            wakeRegistrations.debounceMs,
            wakeRegistrations.timeoutMs,
            wakeRegistrations.condition,
            wakeRegistrations.manifestKey,
          ],
          set: {
            id: row.id,
            timeoutConsumed: row.timeoutConsumed,
            includeResponse: row.includeResponse,
            createdAt: sql`${wakeRegistrations.createdAt}`,
          },
        })
        .returning({
          id: wakeRegistrations.id,
          tenantId: wakeRegistrations.tenantId,
          subscriberUrl: wakeRegistrations.subscriberUrl,
          sourceUrl: wakeRegistrations.sourceUrl,
          condition: wakeRegistrations.condition,
          debounceMs: wakeRegistrations.debounceMs,
          timeoutMs: wakeRegistrations.timeoutMs,
          oneShot: wakeRegistrations.oneShot,
          timeoutConsumed: wakeRegistrations.timeoutConsumed,
          includeResponse: wakeRegistrations.includeResponse,
          manifestKey: wakeRegistrations.manifestKey,
          createdAt: wakeRegistrations.createdAt,
          txid: sql<string>`pg_current_xact_id()::xid::text`,
        })
      const inserted = rows[0]
      if (!inserted) throw new Error(`Wake registration insert returned no row`)
      return {
        txid: Number(inserted.txid),
        row: {
          id: inserted.id,
          tenantId: inserted.tenantId,
          subscriberUrl: inserted.subscriberUrl,
          sourceUrl: inserted.sourceUrl,
          condition: inserted.condition as WakeRegistration[`condition`],
          debounceMs: inserted.debounceMs,
          timeoutMs: inserted.timeoutMs,
          oneShot: inserted.oneShot,
          timeoutConsumed: inserted.timeoutConsumed,
          includeResponse: inserted.includeResponse,
          manifestKey: inserted.manifestKey,
          createdAt: inserted.createdAt,
        },
      }
    })
  }

  private async persistTimeoutConsumed(
    row: WakeRegistrationCollectionRow
  ): Promise<number | undefined> {
    return await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(wakeRegistrations)
        .set({ timeoutConsumed: row.timeoutConsumed })
        .where(
          and(
            eq(wakeRegistrations.tenantId, row.tenantId),
            eq(wakeRegistrations.id, row.id)
          )
        )
        .returning({ txid: sql<string>`pg_current_xact_id()::xid::text` })
      return rows[0]?.txid === undefined ? undefined : Number(rows[0].txid)
    })
  }

  private deletePredicate(input: DeleteRowsInput) {
    switch (input.persist.kind) {
      case `manifestKey`:
        return and(
          eq(wakeRegistrations.tenantId, input.persist.tenantId),
          eq(wakeRegistrations.subscriberUrl, input.persist.subscriberUrl),
          eq(wakeRegistrations.manifestKey, input.persist.manifestKey)
        )
      case `subscriber`:
        return and(
          eq(wakeRegistrations.tenantId, input.persist.tenantId),
          eq(wakeRegistrations.subscriberUrl, input.persist.subscriberUrl)
        )
      case `source`:
        return and(
          eq(wakeRegistrations.tenantId, input.persist.tenantId),
          eq(wakeRegistrations.sourceUrl, input.persist.sourceUrl)
        )
      case `subscriberAndSource`:
        return and(
          eq(wakeRegistrations.tenantId, input.persist.tenantId),
          eq(wakeRegistrations.subscriberUrl, input.persist.subscriberUrl),
          eq(wakeRegistrations.sourceUrl, input.persist.sourceUrl)
        )
      case `oneShot`:
        return input.rows.length === 0
          ? undefined
          : inArray(
              wakeRegistrations.id,
              input.rows.map((row) => row.id)
            )
    }
  }

  private async persistDeleteRows(
    input: DeleteRowsInput
  ): Promise<number | undefined> {
    const predicate = this.deletePredicate(input)
    if (!predicate) return undefined
    return await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(wakeRegistrations)
        .where(predicate)
        .returning({ txid: sql<string>`pg_current_xact_id()::xid::text` })
      return deleted[0]?.txid === undefined
        ? undefined
        : Number(deleted[0].txid)
    })
  }

  private registrationRowsMatch(
    row: WakeRegistrationCollectionRow,
    other: WakeRegistrationCollectionRow
  ): boolean {
    return (
      row.tenantId === other.tenantId &&
      row.subscriberUrl === other.subscriberUrl &&
      row.sourceUrl === other.sourceUrl &&
      JSON.stringify(row.condition) === JSON.stringify(other.condition) &&
      row.debounceMs === other.debounceMs &&
      row.timeoutMs === other.timeoutMs &&
      row.oneShot === other.oneShot &&
      row.manifestKey === other.manifestKey
    )
  }

  private registrationMatches(
    row: WakeRegistrationCollectionRow,
    reg: WakeRegistration,
    tenantId: string
  ): boolean {
    return this.registrationRowsMatch(
      row,
      this.normalizeRegistration(reg, tenantId, row.id)
    )
  }

  private async waitForRegistrationVisible(
    row: WakeRegistrationCollectionRow,
    timeoutMs = 10_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    do {
      const rows = await this.rowsByPredicate((candidate) =>
        this.registrationRowsMatch(candidate, row)
      )
      if (rows.length > 0) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    } while (Date.now() < deadline)
  }

  async register(reg: WakeRegistration): Promise<void> {
    const tenantId = this.resolveTenantId(reg.tenantId)
    if (this.registrationsCollection) {
      const existing = await this.rowsByPredicate((row) =>
        this.registrationMatches(row, reg, tenantId)
      )
      if (existing.length > 0) return
    }
    const id = await this.allocateRegistrationId()
    const tx = this.registerAction(
      this.normalizeRegistration(reg, tenantId, id)
    )
    try {
      await tx.isPersisted.promise
    } catch (error) {
      if (error instanceof WakeRegistrationConflictError) {
        await this.waitForRegistrationVisible(error.row)
        return
      }
      throw error
    }
  }

  private startTimeoutTimer(reg: WakeRegistrationCollectionRow): void {
    if (reg.timeoutMs <= 0) return
    this.startTimeoutTimerWithDuration(reg, reg.timeoutMs)
  }

  private async markTimeoutConsumed(
    dbId: number,
    tenantId: string
  ): Promise<void> {
    if (this.registrationsCollection) {
      const row = await queryOnce((q) =>
        q
          .from({ reg: this.requireCollection() })
          .where(({ reg }) =>
            dbAnd(dbEq(reg.tenantId, tenantId), dbEq(reg.id, dbId))
          )
          .findOne()
      )
      const queried = row as
        | { reg?: WakeRegistrationCollectionRow }
        | WakeRegistrationCollectionRow
        | undefined
      const normalized = (
        queried && `reg` in queried ? queried.reg : queried
      ) as WakeRegistrationCollectionRow | undefined
      if (!normalized) return
      const tx = this.markTimeoutConsumedAction({ row: normalized })
      try {
        await tx.isPersisted.promise
      } catch (error) {
        if (error instanceof WakeRegistrationStaleError) return
        throw error
      }
      return
    }
    await this.db
      .update(wakeRegistrations)
      .set({ timeoutConsumed: true })
      .where(
        and(
          eq(wakeRegistrations.tenantId, tenantId),
          eq(wakeRegistrations.id, dbId)
        )
      )
  }

  private async deleteRows(input: DeleteRowsInput): Promise<void> {
    if (this.registrationsCollection && input.rows.length > 0) {
      const tx = this.deleteRowsAction(input)
      await tx.isPersisted.promise
      return
    }
    if (this.mode === `electric`) {
      await this.persistDeleteRows(input)
    }
  }

  async unregisterByManifestKey(
    subscriberUrl: string,
    manifestKey: string,
    tenantId?: string
  ): Promise<void> {
    if (this.registrationsCollection) {
      const resolvedTenantId = this.resolveTenantId(tenantId)
      const rows = await this.rowsByPredicate(
        (row) =>
          row.tenantId === resolvedTenantId &&
          row.subscriberUrl === subscriberUrl &&
          row.manifestKey === manifestKey
      )
      await this.deleteRows({
        rows,
        persist: {
          kind: `manifestKey`,
          tenantId: resolvedTenantId,
          subscriberUrl,
          manifestKey,
        },
      })
      return
    }

    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.subscriberUrl, subscriberUrl),
          eq(wakeRegistrations.manifestKey, manifestKey)
        )
      )
  }

  async unregisterBySubscriber(
    subscriberUrl: string,
    tenantId?: string
  ): Promise<void> {
    if (this.registrationsCollection) {
      const resolvedTenantId = this.resolveTenantId(tenantId)
      const rows = await this.rowsByPredicate(
        (row) =>
          row.tenantId === resolvedTenantId &&
          row.subscriberUrl === subscriberUrl
      )
      await this.deleteRows({
        rows,
        persist: {
          kind: `subscriber`,
          tenantId: resolvedTenantId,
          subscriberUrl,
        },
      })
      return
    }

    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.subscriberUrl, subscriberUrl)
        )
      )
  }

  async unregisterBySource(
    sourceUrl: string,
    tenantId?: string
  ): Promise<void> {
    if (this.registrationsCollection) {
      const resolvedTenantId = this.resolveTenantId(tenantId)
      const rows = await this.rowsForSource(resolvedTenantId, sourceUrl)
      await this.deleteRows({
        rows,
        persist: { kind: `source`, tenantId: resolvedTenantId, sourceUrl },
      })
      return
    }

    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.sourceUrl, sourceUrl)
        )
      )
  }

  async unregisterBySubscriberAndSource(
    subscriberUrl: string,
    sourceUrl: string,
    tenantId?: string
  ): Promise<void> {
    if (this.registrationsCollection) {
      const resolvedTenantId = this.resolveTenantId(tenantId)
      const rows = await this.rowsByPredicate(
        (row) =>
          row.tenantId === resolvedTenantId &&
          row.subscriberUrl === subscriberUrl &&
          row.sourceUrl === sourceUrl
      )
      await this.deleteRows({
        rows,
        persist: {
          kind: `subscriberAndSource`,
          tenantId: resolvedTenantId,
          subscriberUrl,
          sourceUrl,
        },
      })
      return
    }

    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.subscriberUrl, subscriberUrl),
          eq(wakeRegistrations.sourceUrl, sourceUrl)
        )
      )
  }

  private startTimeoutTimerWithDuration(
    reg: WakeRegistrationCollectionRow,
    durationMs: number
  ): void {
    const timerKey = this.registrationKey(reg)
    const timer = setTimeout(() => {
      this.timeoutTimers.delete(timerKey)
      this.deliverTimeoutForRegistration(reg)
    }, durationMs)
    this.timeoutTimers.set(timerKey, timer)
  }

  private clearDebounceState(timerKey: string): void {
    const debounceTimer = this.debounceTimers.get(timerKey)
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      this.debounceTimers.delete(timerKey)
      this.debounceBuffers.delete(timerKey)
      this.debounceRunStatus.delete(timerKey)
    }
  }

  private clearTimeoutState(timerKey: string): void {
    const timeoutTimer = this.timeoutTimers.get(timerKey)
    if (timeoutTimer) {
      clearTimeout(timeoutTimer)
      this.timeoutTimers.delete(timerKey)
    }
  }

  private clearRegistrationState(reg: WakeRegistrationCollectionRow): void {
    const timerKey = this.registrationKey(reg)
    this.clearDebounceState(timerKey)
    this.clearTimeoutState(timerKey)
  }

  private syncTimeoutTimer(registration: WakeRegistrationCollectionRow): void {
    const reg = registration
    const timerKey = this.registrationKey(reg)

    if (reg.timeoutConsumed || reg.timeoutMs <= 0) {
      this.clearTimeoutState(timerKey)
      return
    }

    if (this.timeoutTimers.has(timerKey)) {
      return
    }

    const remaining = reg.createdAt.getTime() + reg.timeoutMs - Date.now()
    if (remaining > 0) {
      this.startTimeoutTimerWithDuration(reg, remaining)
      return
    }

    if (this.timeoutDelivered.has(reg.id)) {
      return
    }

    this.deliverTimeoutForRegistration(reg)
  }

  private deliverTimeoutForRegistration(
    reg: WakeRegistrationCollectionRow
  ): void {
    if (this.deliverTimeout(this.timeoutWakeResult(reg))) {
      this.timeoutDelivered.add(reg.id)
      void this.markTimeoutConsumed(reg.id, reg.tenantId).catch((error) => {
        serverLog.warn(
          `[wake-registry] failed to mark timeout consumed for registration ${reg.id} (${reg.tenantId}, ${reg.sourceUrl} -> ${reg.subscriberUrl}):`,
          error
        )
      })
    }
  }

  private syncTenantTimeoutTimers(tenantId: string): void {
    void this.syncTenantCollectionTimeoutTimers(tenantId)
  }

  private async syncTenantCollectionTimeoutTimers(
    tenantId: string
  ): Promise<void> {
    if (!this.registrationsCollection) return
    const rows = await queryOnce((q) =>
      q
        .from({ reg: this.requireCollection() })
        .where(({ reg }) => dbEq(reg.tenantId, tenantId))
    )
    for (const queriedRow of rows) {
      const row = ((queriedRow as { reg?: WakeRegistrationCollectionRow })
        .reg ?? queriedRow) as WakeRegistrationCollectionRow
      this.syncTimeoutTimer(row)
    }
  }

  private timeoutWakeResult(
    reg: WakeRegistrationCollectionRow
  ): WakeEvalResult {
    return {
      tenantId: reg.tenantId,
      subscriberUrl: reg.subscriberUrl,
      registrationDbId: reg.id,
      sourceEventKey: `timeout`,
      wakeMessage: {
        source: reg.sourceUrl,
        timeout: true,
        changes: [],
      },
    }
  }

  async evaluate(
    sourceUrl: string,
    event: Record<string, unknown>,
    tenantId?: string
  ): Promise<Array<WakeEvalResult>> {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    const queriedRegs = await queryOnce((q) =>
      q
        .from({ reg: this.requireCollection() })
        .where(({ reg }) =>
          dbAnd(
            dbEq(reg.tenantId, resolvedTenantId),
            dbEq(reg.sourceUrl, sourceUrl)
          )
        )
    )
    const regs = queriedRegs.map(
      (queriedReg) =>
        ((queriedReg as { reg?: WakeRegistrationCollectionRow }).reg ??
          queriedReg) as WakeRegistrationCollectionRow
    )
    if (regs.length === 0) return []

    const results: Array<WakeEvalResult> = []
    const oneShotRows: Array<WakeRegistrationCollectionRow> = []

    for (const reg of regs) {
      const match = this.matchCondition(reg, event)
      if (!match) continue

      const timerKey = this.registrationKey(reg)
      const timeoutTimer = this.timeoutTimers.get(timerKey)
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        this.timeoutTimers.delete(timerKey)
        void this.markTimeoutConsumed(reg.id, reg.tenantId).catch((error) => {
          console.warn(
            `[wake-registry] failed to persist timeout consumption:`,
            error
          )
        })
      }

      if (reg.debounceMs > 0) {
        const buffer = this.debounceBuffers.get(timerKey) ?? []
        buffer.push(match.change)
        this.debounceBuffers.set(timerKey, buffer)

        if (match.runFinishedStatus) {
          this.debounceRunStatus.set(timerKey, match.runFinishedStatus)
        }

        const existing = this.debounceTimers.get(timerKey)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
          this.debounceTimers.delete(timerKey)
          const flushed = this.debounceBuffers.get(timerKey)
          if (flushed && flushed.length > 0) {
            this.debounceBuffers.delete(timerKey)
            const runStatus = this.debounceRunStatus.get(timerKey)
            this.debounceRunStatus.delete(timerKey)
            this.deliverDebounce({
              tenantId: reg.tenantId,
              subscriberUrl: reg.subscriberUrl,
              registrationDbId: reg.id,
              sourceEventKey: flushed[flushed.length - 1]!.key,
              wakeMessage: {
                source: sourceUrl,
                timeout: false,
                changes: flushed,
              },
              runFinishedStatus: runStatus,
              includeResponse: reg.includeResponse,
            })
          }
        }, reg.debounceMs)
        this.debounceTimers.set(timerKey, timer)
      } else {
        results.push({
          tenantId: reg.tenantId,
          subscriberUrl: reg.subscriberUrl,
          registrationDbId: reg.id,
          sourceEventKey: wakeSourceEventId(event),
          wakeMessage: {
            source: sourceUrl,
            timeout: false,
            changes: [match.change],
          },
          runFinishedStatus: match.runFinishedStatus,
          includeResponse: reg.includeResponse,
        })
      }

      if (reg.oneShot) {
        oneShotRows.push(reg)
      }
    }

    if (oneShotRows.length > 0) {
      const tx = this.deleteRowsAction({
        rows: oneShotRows,
        persist: { kind: `oneShot` },
      })
      void tx.isPersisted.promise.catch((error) => {
        console.warn(
          `[wake-registry] failed to persist one-shot cleanup:`,
          error
        )
      })
    }

    return results
  }

  /** Flush any pending debounce buffers for a subscriber and return them. */
  flushDebounce(
    subscriberUrl: string,
    sourceUrl: string,
    tenantId?: string
  ): WakeEvalResult | null {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    const timerKeyPrefix = `${resolvedTenantId}:${subscriberUrl}:${sourceUrl}:`
    const changes: Array<WakeEvalResult[`wakeMessage`][`changes`][number]> = []

    for (const [timerKey, buffer] of this.debounceBuffers.entries()) {
      if (!timerKey.startsWith(timerKeyPrefix)) continue
      changes.push(...buffer)
      this.debounceBuffers.delete(timerKey)

      const timer = this.debounceTimers.get(timerKey)
      if (timer) {
        clearTimeout(timer)
        this.debounceTimers.delete(timerKey)
      }
      this.debounceRunStatus.delete(timerKey)
    }

    if (changes.length === 0) return null

    return {
      tenantId: resolvedTenantId,
      subscriberUrl,
      registrationDbId: -1,
      sourceEventKey: changes[changes.length - 1]!.key,
      wakeMessage: {
        source: sourceUrl,
        timeout: false,
        changes,
      },
    }
  }

  private matchCondition(
    reg: WakeRegistration | WakeRegistrationCollectionRow,
    event: Record<string, unknown>
  ): {
    change: WakeEvalResult[`wakeMessage`][`changes`][number]
    runFinishedStatus?: `completed` | `failed`
  } | null {
    if (reg.condition === `runFinished`) {
      if (event.type !== `run`) return null
      const value = event.value as Record<string, unknown> | undefined
      const headers = event.headers as Record<string, unknown> | undefined
      const status = value?.status as string | undefined
      const operation = headers?.operation as string | undefined
      if (operation !== `update`) return null
      if (status !== `completed` && status !== `failed`) return null
      return {
        change: {
          collection: `runs`,
          kind: `update`,
          key: (event.key as string) || `run`,
        },
        runFinishedStatus: status,
      }
    }

    const condition = reg.condition
    const eventType = event.type as string | undefined
    const headers = event.headers as Record<string, unknown> | undefined
    const operation = headers?.operation as string | undefined
    if (!eventType) return null

    if (condition.collections && condition.collections.length > 0) {
      if (!condition.collections.includes(eventType)) return null
    }

    const kind: `insert` | `update` | `delete` =
      operation === `delete`
        ? `delete`
        : operation === `update`
          ? `update`
          : `insert`

    if (
      condition.ops &&
      condition.ops.length > 0 &&
      !condition.ops.includes(kind)
    ) {
      return null
    }

    const value = event.value as Record<string, unknown> | undefined
    const change: WakeEvalResult[`wakeMessage`][`changes`][number] = {
      collection: eventType,
      kind,
      key: (event.key as string) || ``,
    }

    if (value && `value` in value) {
      change.value = value.value
    }
    if (value && `oldValue` in value) {
      change.oldValue = value.oldValue
    } else if (value && `old_value` in value) {
      change.oldValue = value.old_value
    }

    if (eventType === `inbox`) {
      if (typeof value?.from === `string`) change.from = value.from
      if (typeof value?.from_principal === `string`) {
        change.from_principal = value.from_principal
      }
      if (typeof value?.from_agent === `string`) {
        change.from_agent = value.from_agent
      }
      if (`payload` in (value ?? {})) change.payload = value?.payload
      if (typeof value?.timestamp === `string`)
        change.timestamp = value.timestamp
      if (typeof value?.message_type === `string`) {
        change.message_type = value.message_type
      }
    }

    return { change }
  }
}
