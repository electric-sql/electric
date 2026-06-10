import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
import { and, eq } from 'drizzle-orm'
import { wakeRegistrations } from './db/schema.js'
import { serverLog } from './utils/log.js'
import { electricUrlWithPath } from './utils/electric-url.js'
import { DEFAULT_TENANT_ID } from './tenant.js'
import type { DrizzleDB } from './db/index.js'
import type { Message, Row, Value } from '@electric-sql/client'

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

interface CachedWakeRegistration extends WakeRegistration {
  tenantId: string
  dbId: number
  createdAt?: Date
  timeoutConsumed?: boolean
}

interface WakeRegistrationShapeRow extends Row<Date> {
  id: number
  tenant_id: string
  subscriber_url: string
  source_url: string
  condition: WakeRegistration[`condition`] & Value<Date>
  debounce_ms: number
  timeout_ms: number
  one_shot: boolean
  timeout_consumed: boolean
  include_response: boolean
  manifest_key: string | null
  created_at: Date
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

export class WakeRegistry {
  private db: DrizzleDB
  private registrationCache = new Map<string, Array<CachedWakeRegistration>>()
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
  private syncElectricUrl: string | null = null
  private syncElectricSecret: string | undefined
  private syncAbortController: AbortController | null = null
  private syncUnsubscribe: (() => void) | null = null
  private syncReadyPromise: Promise<void> | null = null
  private syncRecoveryPromise: Promise<void> | null = null

  constructor(
    db: DrizzleDB,
    readonly tenantId: string | null = DEFAULT_TENANT_ID
  ) {
    this.db = db
  }

  setTimeoutCallback(cb: WakeTimeoutCallback, tenantId?: string): void {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    this.timeoutCallbacks.set(resolvedTenantId, cb)
    this.syncTenantTimeoutTimers(resolvedTenantId)
  }

  setDebounceCallback(cb: WakeDebounceCallback, tenantId?: string): void {
    this.debounceCallbacks.set(this.resolveTenantId(tenantId), cb)
  }

  private resolveTenantId(tenantId?: string): string {
    if (tenantId) return tenantId
    if (this.tenantId) return this.tenantId
    throw new Error(`WakeRegistry tenantId is required in shared mode`)
  }

  private cacheKey(tenantId: string, sourceUrl: string): string {
    return `${tenantId}:${sourceUrl}`
  }

  private registrationKey(reg: CachedWakeRegistration): string {
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
    if (this.syncReadyPromise) {
      await this.syncReadyPromise
      return
    }

    this.syncElectricUrl = electricUrl
    this.syncElectricSecret = electricSecret

    const abortController = new AbortController()
    const stream = new ShapeStream<WakeRegistrationShapeRow>({
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
      signal: abortController.signal,
      onError: (error) => {
        if (abortController.signal.aborted) {
          return {}
        }
        if (this.syncReadyPromise) {
          void this.recoverSync(error, `shape stream error`)
        }
        return {}
      },
    })

    this.syncAbortController = abortController
    this.syncReadyPromise = new Promise<void>((resolve, reject) => {
      let settled = false

      this.syncUnsubscribe = stream.subscribe(
        async (messages) => {
          try {
            for (const message of messages) {
              await this.applyShapeMessage(message)
              if (
                !settled &&
                isControlMessage(message) &&
                message.headers.control === `up-to-date`
              ) {
                settled = true
                resolve()
              }
            }
          } catch (error) {
            if (!settled) {
              settled = true
              reject(error)
              return
            }
            serverLog.error(
              `[wake-registry] failed to apply shape change:`,
              error
            )
          }
        },
        (error) => {
          if (!settled) {
            settled = true
            reject(error)
            return
          }
          void this.recoverSync(error, `subscription error`)
        }
      )
    })

    try {
      await this.syncReadyPromise
    } catch (error) {
      await this.stopSync()
      throw error
    }
  }

  async stopSync(): Promise<void> {
    this.syncUnsubscribe?.()
    this.syncUnsubscribe = null
    this.syncAbortController?.abort()
    this.syncAbortController = null
    this.syncReadyPromise = null
  }

  private async recoverSync(
    error: unknown,
    source: `shape stream error` | `subscription error`
  ): Promise<void> {
    if (this.syncRecoveryPromise) {
      return this.syncRecoveryPromise
    }

    const electricUrl = this.syncElectricUrl
    if (!electricUrl) {
      serverLog.error(
        `[wake-registry] Electric sync failed (${source}):`,
        error
      )
      return
    }

    this.syncRecoveryPromise = (async () => {
      serverLog.error(
        `[wake-registry] Electric sync failed (${source}):`,
        error
      )

      await this.stopSync()
      await this.loadRegistrations()

      try {
        await this.startSync(electricUrl, this.syncElectricSecret)
        serverLog.info(`[wake-registry] Electric sync recovered`)
      } catch (recoveryError) {
        serverLog.error(
          `[wake-registry] Electric sync recovery failed:`,
          recoveryError
        )
      } finally {
        this.syncRecoveryPromise = null
      }
    })()

    return this.syncRecoveryPromise
  }

  async register(reg: WakeRegistration): Promise<void> {
    const tenantId = this.resolveTenantId(reg.tenantId)
    const result = await this.db
      .insert(wakeRegistrations)
      .values({
        tenantId,
        subscriberUrl: reg.subscriberUrl,
        sourceUrl: reg.sourceUrl,
        condition: reg.condition,
        debounceMs: reg.debounceMs ?? 0,
        timeoutMs: reg.timeoutMs ?? 0,
        oneShot: reg.oneShot,
        includeResponse: reg.includeResponse !== false,
        manifestKey: reg.manifestKey ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: wakeRegistrations.id })

    if (result.length === 0) {
      // Another path (e.g. manifest-sync) may have created the row first.
      // Refresh the cache so this process still sees the effective registration.
      await this.loadRegistrations()
      return
    }

    const dbId = result[0]!.id
    this.upsertCachedRegistration({
      ...reg,
      tenantId,
      dbId,
      createdAt: new Date(),
      timeoutConsumed: false,
    })
  }

  private startTimeoutTimer(reg: CachedWakeRegistration, dbId: number): void {
    if (reg.timeoutMs == null || reg.timeoutMs <= 0) return
    this.startTimeoutTimerWithDuration(reg, dbId, reg.timeoutMs)
  }

  private async markTimeoutConsumed(
    dbId: number,
    tenantId: string
  ): Promise<void> {
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

  async unregisterByManifestKey(
    subscriberUrl: string,
    manifestKey: string,
    tenantId?: string
  ): Promise<void> {
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

    const toRemove = Array.from(this.registrationCache.values()).flatMap(
      (regs) =>
        regs
          .filter(
            (r) =>
              r.tenantId === resolvedTenantId &&
              r.subscriberUrl === subscriberUrl &&
              r.manifestKey === manifestKey
          )
          .map((r) => r.dbId)
    )

    for (const dbId of toRemove) {
      this.removeCachedRegistrationByDbId(dbId)
    }
  }

  async unregisterBySubscriber(
    subscriberUrl: string,
    tenantId?: string
  ): Promise<void> {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.subscriberUrl, subscriberUrl)
        )
      )

    const toRemove = Array.from(this.registrationCache.values()).flatMap(
      (regs) =>
        regs
          .filter(
            (r) =>
              r.tenantId === resolvedTenantId &&
              r.subscriberUrl === subscriberUrl
          )
          .map((r) => r.dbId)
    )
    for (const dbId of toRemove) {
      this.removeCachedRegistrationByDbId(dbId)
    }
  }

  async unregisterBySource(
    sourceUrl: string,
    tenantId?: string
  ): Promise<void> {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    await this.db
      .delete(wakeRegistrations)
      .where(
        and(
          eq(wakeRegistrations.tenantId, resolvedTenantId),
          eq(wakeRegistrations.sourceUrl, sourceUrl)
        )
      )

    const key = this.cacheKey(resolvedTenantId, sourceUrl)
    const regs = this.registrationCache.get(key)
    if (regs) {
      for (const reg of [...regs]) {
        this.removeCachedRegistrationByDbId(reg.dbId)
      }
      this.registrationCache.delete(key)
    }
  }

  async unregisterBySubscriberAndSource(
    subscriberUrl: string,
    sourceUrl: string,
    tenantId?: string
  ): Promise<void> {
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

    const regs = this.registrationCache.get(
      this.cacheKey(resolvedTenantId, sourceUrl)
    )
    if (regs) {
      const toRemove = regs
        .filter(
          (r) =>
            r.tenantId === resolvedTenantId && r.subscriberUrl === subscriberUrl
        )
        .map((r) => r.dbId)
      for (const dbId of toRemove) {
        this.removeCachedRegistrationByDbId(dbId)
      }
    }
  }

  async loadRegistrations(): Promise<void> {
    const rows =
      this.tenantId === null
        ? await this.db.select().from(wakeRegistrations)
        : await this.db
            .select()
            .from(wakeRegistrations)
            .where(eq(wakeRegistrations.tenantId, this.tenantId))

    this.resetCachedRegistrations()

    for (const row of rows) {
      const reg: CachedWakeRegistration = {
        tenantId: row.tenantId,
        subscriberUrl: row.subscriberUrl,
        sourceUrl: row.sourceUrl,
        condition: row.condition as WakeRegistration[`condition`],
        debounceMs: row.debounceMs || undefined,
        timeoutMs: row.timeoutMs || undefined,
        oneShot: row.oneShot,
        includeResponse: row.includeResponse === false ? false : undefined,
        manifestKey: row.manifestKey ?? undefined,
        dbId: row.id,
        createdAt: row.createdAt,
        timeoutConsumed: row.timeoutConsumed,
      }
      this.upsertCachedRegistration(reg)
    }
  }

  private startTimeoutTimerWithDuration(
    reg: CachedWakeRegistration,
    dbId: number,
    durationMs: number
  ): void {
    const timerKey = this.registrationKey(reg)
    const timer = setTimeout(() => {
      this.timeoutTimers.delete(timerKey)
      this.deliverTimeoutForRegistration(reg, dbId)
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

  private clearRegistrationState(reg: CachedWakeRegistration): void {
    const timerKey = this.registrationKey(reg)
    this.clearDebounceState(timerKey)
    this.clearTimeoutState(timerKey)
  }

  private resetCachedRegistrations(): void {
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
    this.registrationCache.clear()
  }

  private findCachedRegistration(
    dbId: number
  ): { cacheKey: string; index: number; reg: CachedWakeRegistration } | null {
    for (const [cacheKey, regs] of this.registrationCache) {
      const index = regs.findIndex((reg) => reg.dbId === dbId)
      if (index >= 0) {
        return {
          cacheKey,
          index,
          reg: regs[index]!,
        }
      }
    }

    return null
  }

  private upsertCachedRegistration(reg: CachedWakeRegistration): void {
    const existing = this.findCachedRegistration(reg.dbId)
    const nextKey = this.registrationKey(reg)

    if (existing) {
      const previousKey = this.registrationKey(existing.reg)
      const regs = this.registrationCache.get(existing.cacheKey)
      if (regs) {
        regs.splice(existing.index, 1)
        if (regs.length === 0) {
          this.registrationCache.delete(existing.cacheKey)
        }
      }
      if (previousKey !== nextKey) {
        this.clearRegistrationState(existing.reg)
      }
    }

    const cacheKey = this.cacheKey(reg.tenantId, reg.sourceUrl)
    const cached = this.registrationCache.get(cacheKey) ?? []
    cached.push(reg)
    this.registrationCache.set(cacheKey, cached)
    this.syncTimeoutTimer(reg)
  }

  private removeCachedRegistrationByDbId(dbId: number): void {
    const existing = this.findCachedRegistration(dbId)
    if (!existing) return

    this.clearRegistrationState(existing.reg)
    this.timeoutDelivered.delete(dbId)

    const regs = this.registrationCache.get(existing.cacheKey)
    if (!regs) return
    regs.splice(existing.index, 1)
    if (regs.length === 0) {
      this.registrationCache.delete(existing.cacheKey)
    }
  }

  private syncTimeoutTimer(reg: CachedWakeRegistration): void {
    const timerKey = this.registrationKey(reg)

    if (reg.timeoutConsumed || reg.timeoutMs == null || reg.timeoutMs <= 0) {
      this.clearTimeoutState(timerKey)
      return
    }

    if (this.timeoutTimers.has(timerKey)) {
      return
    }

    if (!reg.createdAt) {
      this.startTimeoutTimer(reg, reg.dbId)
      return
    }

    const remaining = reg.createdAt.getTime() + reg.timeoutMs - Date.now()
    if (remaining > 0) {
      this.startTimeoutTimerWithDuration(reg, reg.dbId, remaining)
      return
    }

    if (this.timeoutDelivered.has(reg.dbId)) {
      return
    }

    this.deliverTimeoutForRegistration(reg, reg.dbId)
  }

  private deliverTimeoutForRegistration(
    reg: CachedWakeRegistration,
    dbId: number
  ): void {
    if (this.deliverTimeout(this.timeoutWakeResult(reg, dbId))) {
      this.timeoutDelivered.add(dbId)
      void this.markTimeoutConsumed(dbId, reg.tenantId)
    }
  }

  private syncTenantTimeoutTimers(tenantId: string): void {
    for (const regs of this.registrationCache.values()) {
      for (const reg of regs) {
        if (reg.tenantId === tenantId) {
          this.syncTimeoutTimer(reg)
        }
      }
    }
  }

  private timeoutWakeResult(
    reg: CachedWakeRegistration,
    dbId: number
  ): WakeEvalResult {
    return {
      tenantId: reg.tenantId,
      subscriberUrl: reg.subscriberUrl,
      registrationDbId: dbId,
      sourceEventKey: `timeout`,
      wakeMessage: {
        source: reg.sourceUrl,
        timeout: true,
        changes: [],
      },
    }
  }

  private normalizeShapeRow(
    row: WakeRegistrationShapeRow
  ): CachedWakeRegistration {
    return {
      tenantId:
        (row as { tenant_id?: string }).tenant_id ?? this.resolveTenantId(),
      subscriberUrl: row.subscriber_url,
      sourceUrl: row.source_url,
      condition: row.condition,
      debounceMs: row.debounce_ms || undefined,
      timeoutMs: row.timeout_ms || undefined,
      oneShot: row.one_shot,
      includeResponse: row.include_response === false ? false : undefined,
      manifestKey: row.manifest_key ?? undefined,
      dbId: row.id,
      createdAt: row.created_at,
      timeoutConsumed: row.timeout_consumed,
    }
  }

  private async applyShapeMessage(
    message: Message<WakeRegistrationShapeRow>
  ): Promise<void> {
    if (isControlMessage(message)) {
      if (message.headers.control === `must-refetch`) {
        this.resetCachedRegistrations()
      }
      return
    }

    if (!isChangeMessage(message)) {
      return
    }

    if (message.headers.operation === `delete`) {
      this.removeCachedRegistrationByDbId(Number(message.key))
      return
    }

    this.upsertCachedRegistration(this.normalizeShapeRow(message.value))
  }

  evaluate(
    sourceUrl: string,
    event: Record<string, unknown>,
    tenantId?: string
  ): Array<WakeEvalResult> {
    const resolvedTenantId = this.resolveTenantId(tenantId)
    const cacheKey = this.cacheKey(resolvedTenantId, sourceUrl)
    const regs = this.registrationCache.get(cacheKey)
    if (!regs || regs.length === 0) return []

    const results: Array<WakeEvalResult> = []
    const toRemove: Array<number> = []

    for (let i = 0; i < regs.length; i++) {
      const reg = regs[i]!
      const match = this.matchCondition(reg, event)
      if (!match) continue

      const timerKey = this.registrationKey(reg)
      const timeoutTimer = this.timeoutTimers.get(timerKey)
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        this.timeoutTimers.delete(timerKey)
        void this.markTimeoutConsumed(reg.dbId, reg.tenantId)
      }

      if (reg.debounceMs != null && reg.debounceMs > 0) {
        const buffer = this.debounceBuffers.get(timerKey) ?? []
        buffer.push(match.change)
        this.debounceBuffers.set(timerKey, buffer)

        // Preserve the latest runFinished status for debounced delivery
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
              registrationDbId: reg.dbId,
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
          registrationDbId: reg.dbId,
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
        toRemove.push(i)
      }
    }

    for (let j = toRemove.length - 1; j >= 0; j--) {
      const removed = regs.splice(toRemove[j]!, 1)
      if (removed[0]) {
        this.clearRegistrationState(removed[0])
        this.timeoutDelivered.delete(removed[0].dbId)
        void this.db
          .delete(wakeRegistrations)
          .where(
            and(
              eq(wakeRegistrations.tenantId, removed[0].tenantId),
              eq(wakeRegistrations.id, removed[0].dbId)
            )
          )
      }
    }
    if (regs.length === 0) {
      this.registrationCache.delete(cacheKey)
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
    reg: WakeRegistration,
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

    const change: WakeEvalResult[`wakeMessage`][`changes`][number] = {
      collection: eventType,
      kind,
      key: (event.key as string) || ``,
    }

    if (eventType === `inbox`) {
      const value = event.value as Record<string, unknown> | undefined
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
