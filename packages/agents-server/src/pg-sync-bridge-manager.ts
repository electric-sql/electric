import { randomUUID } from 'node:crypto'
import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import {
  getPgSyncStreamPath,
  sourceRefForPgSync,
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
import type { Offset, ShapeStreamInterface } from '@electric-sql/client'

export const PG_SYNC_ELECTRIC_SHAPE_URL =
  process.env.ELECTRIC_AGENTS_PG_SYNC_ELECTRIC_URL ??
  `http://localhost:3000/v1/shape`

type PgSyncOperation = `insert` | `update` | `delete`
type WakeEvaluator = (
  sourceUrl: string,
  event: Record<string, unknown>
) => Promise<void> | void

type PgSyncChangeMessage = {
  headers: Record<string, unknown> & { operation?: unknown }
  value?: Record<string, unknown>
  key?: unknown
  old_value?: unknown
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

export function canonicalPgSyncOptions(options: PgSyncOptions): PgSyncOptions {
  return {
    table: options.table,
    ...(options.columns !== undefined ? { columns: [...options.columns] } : {}),
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.params !== undefined
      ? {
          params: Array.isArray(options.params)
            ? [...options.params]
            : Object.keys(options.params)
                .sort()
                .reduce<Record<string, string>>((acc, key) => {
                  acc[key] = (options.params as Record<string, string>)[key]!
                  return acc
                }, {}),
        }
      : {}),
    replica: options.replica ?? `default`,
  }
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
    (message as unknown as { old_value?: Record<string, unknown> }).old_value
      ?.id ??
    (message as unknown as { old_value?: Record<string, unknown> }).old_value
      ?.key
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
  const offset = (message.headers as Record<string, unknown>).offset
  const explicitMessageKey = (message as unknown as { key?: unknown }).key
  const messageKeyPart =
    offset !== undefined
      ? typeof offset === `string`
        ? offset
        : stableJson(offset)
      : explicitMessageKey !== undefined
        ? typeof explicitMessageKey === `string`
          ? explicitMessageKey
          : stableJson(explicitMessageKey)
        : randomUUID()
  const messageKey = `${sourceRef}:${operation}:${messageKeyPart}`
  const timestamp = new Date().toISOString()
  const oldValue = (message as unknown as { old_value?: unknown }).old_value
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

class PgSyncBridge {
  private producer: IdempotentProducer | null = null
  private unsubscribe: (() => void) | null = null
  private abortController: AbortController | null = null
  private skipChangesUntilUpToDate = false

  constructor(
    readonly sourceRef: string,
    readonly streamUrl: string,
    private options: PgSyncOptions,
    private streamClient: StreamClient,
    private registry?: PostgresRegistry,
    private evaluateWakes?: WakeEvaluator,
    private initialShapeHandle?: string,
    private initialShapeOffset?: string
  ) {}

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
    if (this.initialShapeHandle && this.initialShapeOffset) {
      const offset = parseElectricOffset(this.initialShapeOffset)
      if (offset) {
        this.startStream(offset, this.initialShapeHandle, false)
        return
      }
    }
    await this.registry?.clearPgSyncBridgeCursor(this.sourceRef)
    this.startStream(`-1`, undefined, true)
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.abortController?.abort()
    this.unsubscribe = null
    this.abortController = null
    await this.producer?.flush().catch(() => undefined)
    await this.producer?.detach()
    this.producer = null
  }

  private startStream(
    offset: Offset,
    handle?: string,
    skipChangesUntilUpToDate = false
  ): void {
    this.unsubscribe?.()
    this.abortController?.abort()
    this.skipChangesUntilUpToDate = skipChangesUntilUpToDate
    this.abortController = new AbortController()
    const stream: ShapeStreamInterface<Record<string, unknown>> =
      new ShapeStream({
        url: PG_SYNC_ELECTRIC_SHAPE_URL,
        params: buildElectricShapeParams(this.options) as never,
        offset,
        ...(handle ? { handle } : {}),
        signal: this.abortController.signal,
      })
    this.unsubscribe = stream.subscribe(
      async (messages) => {
        for (const message of messages) {
          if (isControlMessage(message)) {
            if (message.headers.control === `must-refetch`) {
              await this.registry?.clearPgSyncBridgeCursor(this.sourceRef)
              this.startStream(`-1`, undefined, true)
              return
            }
            if (message.headers.control === `up-to-date`) {
              this.skipChangesUntilUpToDate = false
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
              await Promise.resolve(this.producer.append(JSON.stringify(event)))
              await this.producer.flush?.()
              await this.evaluateWakes?.(this.streamUrl, event)
            }
          }
          await this.persistCursor(stream)
        }
      },
      (error) =>
        serverLog.warn(
          `[pg-sync-bridge] subscription failed for ${this.sourceRef}:`,
          error
        )
    )
  }

  private async persistCursor(
    stream: ShapeStreamInterface<Record<string, unknown>>
  ): Promise<void> {
    const shapeHandle = stream.shapeHandle
    const shapeOffset = stream.lastOffset
    if (!shapeHandle || !shapeOffset || shapeOffset === `-1`) return
    await this.registry?.updatePgSyncBridgeCursor(
      this.sourceRef,
      shapeHandle,
      shapeOffset
    )
  }
}

export class PgSyncBridgeManager implements PgSyncBridgeCoordinator {
  private bridges = new Map<string, PgSyncBridge>()
  private starting = new Map<string, Promise<void>>()

  constructor(
    private streamClient: StreamClient,
    private evaluateWakes?: WakeEvaluator,
    private registry?: PostgresRegistry
  ) {}

  async start(): Promise<void> {
    const rows = await this.registry?.listPgSyncBridges()
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
    const sourceRef = sourceRefForPgSync(canonicalOptions)
    const streamUrl = getPgSyncStreamPath(sourceRef)
    const row = await this.registry?.upsertPgSyncBridge({
      sourceRef,
      options: canonicalOptions,
      streamUrl,
    })
    await this.registry?.touchPgSyncBridge(sourceRef)
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
            this.streamClient,
            this.registry,
            this.evaluateWakes,
            row?.shapeHandle,
            row?.shapeOffset
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
        const bridge = new PgSyncBridge(
          row.sourceRef,
          row.streamUrl,
          row.options,
          this.streamClient,
          this.registry,
          this.evaluateWakes,
          row.shapeHandle,
          row.shapeOffset
        )
        await bridge.start()
        this.bridges.set(row.sourceRef, bridge)
      })().finally(() => this.starting.delete(row.sourceRef))
      this.starting.set(row.sourceRef, start)
    }
    await start
  }

  async stop(): Promise<void> {
    await Promise.all([...this.bridges.values()].map((bridge) => bridge.stop()))
    this.bridges.clear()
  }
}
