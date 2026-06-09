import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import {
  canonicalPgSyncOptions,
  getPgSyncStreamPath,
  sourceRefForPgSync,
  type CanonicalPgSyncConfig,
  type PgSyncOptions,
} from '@electric-ax/agents-runtime'
import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
import { serverLog } from './utils/log.js'
import type { StreamClient } from './stream-client.js'
import type { PgSyncBridgeRow, PostgresRegistry } from './entity-registry.js'
import type {
  LogMode,
  Offset,
  ShapeStreamInterface,
} from '@electric-sql/client'

export const PG_SYNC_ELECTRIC_SHAPE_URL =
  process.env.ELECTRIC_AGENTS_PG_SYNC_ELECTRIC_URL ??
  `http://localhost:3000/v1/shape`

type PgSyncOperation = `insert` | `update` | `delete`
type WakeEvaluator = (
  sourceUrl: string,
  event: Record<string, unknown>
) => Promise<void> | void

export type PgSyncResolvedSource = {
  url: string
  secret?: string
}

export interface PgSyncBridgeManagerOptions {
  url?: string
  secret?: string
  retry?: {
    initialDelayMs?: number
    maxDelayMs?: number
    random?: () => number
    sleep?: (ms: number) => Promise<void>
  }
}

const DEFAULT_RETRY_INITIAL_DELAY_MS = 1_000
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000

type PgSyncChangeMessage = {
  headers: Record<string, unknown> & {
    operation?: PgSyncOperation | string
    offset?: unknown
    key?: unknown
    rowKey?: unknown
  }
  value?: Record<string, unknown>
  key?: string
  old_value?: Record<string, unknown>
}

type PgSyncCursor = {
  handle: string
  offset: string
  initialSnapshotComplete: boolean
}

export interface PgSyncBridgeCoordinator {
  start?(): Promise<void>
  register(
    options: PgSyncOptions
  ): Promise<{ sourceRef: string; streamUrl: string }>
  stop(): Promise<void>
}

export function buildElectricShapeParams(
  options: PgSyncOptions
): Record<string, unknown> {
  return {
    table: options.table,
    ...(options.columns !== undefined ? { columns: [...options.columns] } : {}),
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.params !== undefined
      ? {
          params: Array.isArray(options.params)
            ? [...options.params]
            : { ...options.params },
        }
      : {}),
    ...(options.replica !== undefined ? { replica: options.replica } : {}),
  }
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === `bigint`) return value.toString()
  if (value === null || typeof value !== `object`) return value
  if (Array.isArray(value)) return value.map(jsonSafe)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      jsonSafe(item),
    ])
  )
}

function stableJson(value: unknown): string {
  if (typeof value === `bigint`) return JSON.stringify(value.toString())
  if (value === null || typeof value !== `object`) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(`,`)}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`
    )
    .join(`,`)}}`
}

function parseElectricOffset(offset: string): Offset | null {
  if (offset === `-1`) return offset
  return /^\d+_\d+$/.test(offset) ? (offset as Offset) : null
}

function rowKeyForMessage(message: PgSyncChangeMessage): string | undefined {
  const headers = message.headers as Record<string, unknown>
  const candidate =
    headers.key ??
    headers.rowKey ??
    message.value?.id ??
    message.value?.key ??
    message.old_value?.id ??
    message.old_value?.key
  return candidate === undefined ? undefined : stableJson(candidate)
}

export function pgSyncMessageToDurableEvent(
  message: PgSyncChangeMessage,
  optionsOrSourceRef: PgSyncOptions | string
): {
  type: `pg_sync_change`
  key: string
  value: Record<string, unknown>
  headers: { operation: PgSyncOperation; timestamp: string }
} | null {
  const operation = message.headers.operation
  if (
    operation !== `insert` &&
    operation !== `update` &&
    operation !== `delete`
  )
    return null

  const sourceRef =
    typeof optionsOrSourceRef === `string`
      ? optionsOrSourceRef
      : sourceRefForPgSync(optionsOrSourceRef)
  const rowKey = rowKeyForMessage(message)
  const offset = message.headers.offset
  if (typeof offset !== `string` || offset.length === 0) return null
  const messageKeyPart = offset
  const messageKey = `${sourceRef}:${operation}:${messageKeyPart}`
  const timestamp = new Date().toISOString()
  const oldValue = message.old_value
  const safeValue = jsonSafe(message.value)
  const safeOldValue = jsonSafe(oldValue)
  const safeHeaders = jsonSafe(message.headers)

  return {
    type: `pg_sync_change`,
    key: messageKey,
    value: {
      key: messageKey,
      table:
        typeof optionsOrSourceRef === `string`
          ? undefined
          : optionsOrSourceRef.table,
      operation,
      ...(rowKey !== undefined ? { rowKey } : {}),
      ...(message.value !== undefined ? { value: safeValue } : {}),
      ...(oldValue !== undefined ? { oldValue: safeOldValue } : {}),
      headers: safeHeaders,
      ...(typeof offset === `string` ? { offset } : {}),
      receivedAt: timestamp,
    },
    headers: { operation, timestamp },
  }
}

function cursorFromRow(
  row:
    | Pick<
        PgSyncBridgeRow,
        `shapeHandle` | `shapeOffset` | `initialSnapshotComplete`
      >
    | undefined
): PgSyncCursor | undefined {
  return row?.shapeHandle && row.shapeOffset
    ? {
        handle: row.shapeHandle,
        offset: row.shapeOffset,
        initialSnapshotComplete: row.initialSnapshotComplete,
      }
    : undefined
}

class PgSyncBridge {
  private producer: IdempotentProducer | null = null
  private unsubscribe: (() => void) | null = null
  private abortController: AbortController | null = null
  private skipChangesUntilUpToDate = false
  private recovering = false
  private committedCursor?: PgSyncCursor
  private retryAttempt = 0

  constructor(
    readonly sourceRef: string,
    readonly streamUrl: string,
    private options: CanonicalPgSyncConfig,
    private resolvedSource: PgSyncResolvedSource,
    private retry: Required<NonNullable<PgSyncBridgeManagerOptions[`retry`]>>,
    private streamClient: StreamClient,
    private registry?: PostgresRegistry,
    private evaluateWakes?: WakeEvaluator,
    private initialCursor?: PgSyncCursor
  ) {
    this.committedCursor = initialCursor
  }

  async start(): Promise<void> {
    if (!this.producer) {
      this.producer = new IdempotentProducer(
        new DurableStream({
          url: `${this.streamClient.baseUrl}${this.streamUrl}`,
          contentType: `application/json`,
        }),
        `pg-sync-bridge-${this.sourceRef}`
      )
    }
    if (this.initialCursor) {
      const offset = parseElectricOffset(this.initialCursor.offset)
      if (offset) {
        this.startStream(
          offset,
          this.initialCursor.handle,
          !this.initialCursor.initialSnapshotComplete
        )
        return
      }
    }
    await this.registry?.clearPgSyncBridgeCursor(this.sourceRef)
    this.startStream(`now`, undefined, true)
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.abortController?.abort()
    this.unsubscribe = null
    this.abortController = null
    try {
      await this.producer?.flush()
    } finally {
      await this.producer?.detach()
      this.producer = null
    }
  }

  private startStream(
    offset: Offset,
    handle?: string,
    skipChangesUntilUpToDate = false,
    log: LogMode = offset === `now` ? `changes_only` : `full`
  ): void {
    this.unsubscribe?.()
    this.abortController?.abort()
    this.skipChangesUntilUpToDate = skipChangesUntilUpToDate
    this.abortController = new AbortController()
    const stream: ShapeStreamInterface<Record<string, unknown>> =
      new ShapeStream({
        url: this.resolvedSource.url,
        params: {
          ...buildElectricShapeParams(this.options),
          ...(this.resolvedSource.secret
            ? { secret: this.resolvedSource.secret }
            : {}),
        } as never,
        offset,
        log,
        ...(handle ? { handle } : {}),
        signal: this.abortController.signal,
      })
    this.unsubscribe = stream.subscribe(
      async (messages) => {
        try {
          for (const message of messages) {
            if (isControlMessage(message)) {
              if (message.headers.control === `must-refetch`) {
                await this.registry?.clearPgSyncBridgeCursor(this.sourceRef)
                this.startStream(`now`, undefined, true)
                return
              }
              if (message.headers.control === `up-to-date`) {
                this.skipChangesUntilUpToDate = false
                await this.persistCursor(stream, true)
                continue
              }
              await this.persistCursor(stream)
              continue
            }
            if (!isChangeMessage(message)) continue
            if (!this.skipChangesUntilUpToDate) {
              const event = pgSyncMessageToDurableEvent(message, this.options)
              if (event) {
                if (!this.producer)
                  throw new Error(`pg-sync producer is not started`)
                await this.producer.append(JSON.stringify(event))
                await this.producer.flush?.()
                await this.evaluateWakes?.(this.streamUrl, event)
              }
            }
            await this.persistCursor(stream)
            this.retryAttempt = 0
          }
        } catch (error) {
          serverLog.warn(
            `[pg-sync-bridge] subscription callback failed for ${this.sourceRef}:`,
            error
          )
          await this.recoverStream()
        }
      },
      (error) => {
        if (this.abortController?.signal.aborted) return
        serverLog.warn(
          `[pg-sync-bridge] subscription failed for ${this.sourceRef}:`,
          error
        )
        void this.recoverStream()
      }
    )
  }

  private async recoverStream(): Promise<void> {
    if (this.recovering) return
    this.recovering = true
    try {
      const attempt = this.retryAttempt++
      const baseDelay = Math.min(
        this.retry.initialDelayMs * 2 ** attempt,
        this.retry.maxDelayMs
      )
      const jitter = Math.floor(baseDelay * 0.2 * this.retry.random())
      const delay = baseDelay + jitter
      if (delay > 0) await this.retry.sleep(delay)

      const offset = this.committedCursor
        ? parseElectricOffset(this.committedCursor.offset)
        : null
      if (offset && this.committedCursor) {
        this.startStream(
          offset,
          this.committedCursor.handle,
          !this.committedCursor.initialSnapshotComplete
        )
      } else {
        await this.registry?.clearPgSyncBridgeCursor(this.sourceRef)
        this.startStream(`now`, undefined, true)
      }
    } finally {
      this.recovering = false
    }
  }

  private async persistCursor(
    stream: ShapeStreamInterface<Record<string, unknown>>,
    initialSnapshotComplete = !this.skipChangesUntilUpToDate
  ): Promise<void> {
    const shapeHandle = stream.shapeHandle
    const shapeOffset = stream.lastOffset
    if (!shapeHandle || !shapeOffset || shapeOffset === `-1`) return
    await this.registry?.updatePgSyncBridgeCursor(
      this.sourceRef,
      shapeHandle,
      shapeOffset,
      initialSnapshotComplete
    )
    this.committedCursor = {
      handle: shapeHandle,
      offset: shapeOffset,
      initialSnapshotComplete,
    }
  }
}

export class PgSyncBridgeManager implements PgSyncBridgeCoordinator {
  private bridges = new Map<string, PgSyncBridge>()
  private starting = new Map<string, Promise<void>>()

  private readonly url: string
  private readonly secret?: string
  private readonly retry: Required<
    NonNullable<PgSyncBridgeManagerOptions[`retry`]>
  >

  constructor(
    private streamClient: StreamClient,
    private evaluateWakes?: WakeEvaluator,
    private registry?: PostgresRegistry,
    options: PgSyncBridgeManagerOptions = {}
  ) {
    this.url = options.url ?? PG_SYNC_ELECTRIC_SHAPE_URL
    this.secret = options.secret ?? process.env.ELECTRIC_AGENTS_PG_SYNC_SECRET
    this.retry = {
      initialDelayMs:
        options.retry?.initialDelayMs ?? DEFAULT_RETRY_INITIAL_DELAY_MS,
      maxDelayMs: options.retry?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
      random: options.retry?.random ?? Math.random,
      sleep:
        options.retry?.sleep ??
        ((ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms))),
    }
  }

  async start(): Promise<void> {
    const rows = await this.registry?.listPgSyncBridges?.()
    if (!rows) return
    await Promise.all(
      rows.map((row) =>
        this.ensureBridge(row).catch((error) => {
          serverLog.warn(
            `[pg-sync-bridge] failed to start ${row.sourceRef}:`,
            error
          )
        })
      )
    )
  }

  async register(
    options: PgSyncOptions
  ): Promise<{ sourceRef: string; streamUrl: string }> {
    const canonicalOptions = canonicalPgSyncOptions(options)
    const resolvedSource = this.resolveSource(canonicalOptions)
    const sourceRef = sourceRefForPgSync(canonicalOptions)
    const streamUrl = getPgSyncStreamPath(sourceRef, this.registry?.tenantId)
    const row = await this.registry?.upsertPgSyncBridge({
      sourceRef,
      options: canonicalOptions,
      streamUrl,
    })
    await this.streamClient.ensure(streamUrl, {
      contentType: `application/json`,
    })
    if (!this.bridges.has(sourceRef)) {
      let start = this.starting.get(sourceRef)
      if (!start) {
        start = (async () => {
          const bridge = new PgSyncBridge(
            sourceRef,
            streamUrl,
            canonicalOptions,
            resolvedSource,
            this.retry,
            this.streamClient,
            this.registry,
            this.evaluateWakes,
            cursorFromRow(row)
          )
          await bridge.start()
          this.bridges.set(sourceRef, bridge)
        })().finally(() => this.starting.delete(sourceRef))
        this.starting.set(sourceRef, start)
      }
      await start
    }
    return { sourceRef, streamUrl }
  }

  private async ensureBridge(row: PgSyncBridgeRow): Promise<void> {
    if (this.bridges.has(row.sourceRef)) return
    let start = this.starting.get(row.sourceRef)
    if (!start) {
      start = (async () => {
        await this.streamClient.ensure(row.streamUrl, {
          contentType: `application/json`,
        })
        const canonicalOptions = canonicalPgSyncOptions(row.options)
        const resolvedSource = this.resolveSource(canonicalOptions)
        const bridge = new PgSyncBridge(
          row.sourceRef,
          row.streamUrl,
          canonicalOptions,
          resolvedSource,
          this.retry,
          this.streamClient,
          this.registry,
          this.evaluateWakes,
          cursorFromRow(row)
        )
        await bridge.start()
        this.bridges.set(row.sourceRef, bridge)
      })().finally(() => this.starting.delete(row.sourceRef))
      this.starting.set(row.sourceRef, start)
    }
    await start
  }

  private resolveSource(options: CanonicalPgSyncConfig): PgSyncResolvedSource {
    return { url: options.url ?? this.url, secret: this.secret }
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.starting.values())
    await Promise.all([...this.bridges.values()].map((bridge) => bridge.stop()))
    this.bridges.clear()
  }
}
