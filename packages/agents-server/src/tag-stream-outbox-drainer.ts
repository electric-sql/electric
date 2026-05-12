import { randomUUID } from 'node:crypto'
import { entityStateSchema } from '@electric-ax/agents-runtime'
import { serverLog } from './utils/log.js'
import { DEFAULT_TENANT_ID, isUnregisteredTenantError } from './tenant.js'
import type { ChangeEvent } from '@durable-streams/state'
import type { PostgresRegistry, TagStreamOutboxRow } from './entity-registry.js'
import type { StreamClient } from './stream-client.js'

const DRAIN_INTERVAL_MS = 500
const MAX_FAILURE_ATTEMPTS = 10

type StreamClientResolver = (
  tenantId: string
) => StreamClient | Promise<StreamClient>
type TenantIdsProvider = () => Iterable<string>

interface TagStreamOutboxDrainerOptions {
  tenantId?: string | null
  tenantIds?: TenantIdsProvider
}

export class TagStreamOutboxDrainer {
  private timer: NodeJS.Timeout | null = null
  private draining = false
  private activeDrain: Promise<void> | null = null
  private stopping = false
  private workerId = randomUUID()
  private readonly streamClientForTenant: StreamClientResolver
  private readonly tenantId: string | null
  private readonly tenantIds?: TenantIdsProvider

  constructor(
    private registry: PostgresRegistry,
    streamClient: StreamClient | StreamClientResolver,
    options?: TagStreamOutboxDrainerOptions
  ) {
    this.streamClientForTenant =
      typeof streamClient === `function` ? streamClient : () => streamClient
    this.tenantId =
      options?.tenantId !== undefined
        ? options.tenantId
        : (registry.tenantId ?? DEFAULT_TENANT_ID)
    this.tenantIds = options?.tenantIds
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.runDrain().catch((error) => {
        serverLog.warn(`[tag-outbox] drain failed:`, error)
      })
    }, DRAIN_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    try {
      await this.activeDrain
    } finally {
      await this.registry.releaseTagOutboxClaims(this.workerId, this.tenantId)
    }
  }

  async drainOnce(): Promise<void> {
    await this.runDrain()
  }

  private async runDrain(): Promise<void> {
    if (this.stopping) return
    if (this.draining) return
    this.draining = true
    const drainPromise = (async () => {
      const rows = await this.claimRows(25)
      for (const row of rows) {
        await this.publishRow(row).catch((error) => {
          return this.handlePublishFailure(row, error)
        })
      }
    })()
    this.activeDrain = drainPromise

    try {
      await drainPromise
    } finally {
      this.activeDrain = null
      this.draining = false
    }
  }

  private async claimRows(limit: number): Promise<Array<TagStreamOutboxRow>> {
    const tenantIds = this.sharedTenantIds()
    if (!tenantIds) {
      return await this.registry.claimTagOutboxRows(
        this.workerId,
        limit,
        this.tenantId
      )
    }
    if (tenantIds.length === 0) return []

    const rows: Array<TagStreamOutboxRow> = []
    for (const tenantId of tenantIds) {
      const remaining = limit - rows.length
      if (remaining <= 0) break
      rows.push(
        ...(await this.registry.claimTagOutboxRows(
          this.workerId,
          remaining,
          tenantId
        ))
      )
    }
    return rows
  }

  // Per-row producer identity (producerId = tag-outbox-${row.id}, epoch=0,
  // seq=0) is deliberate: the protocol requires same-epoch seqs to be
  // contiguous (PROTOCOL.md), so a shared per-entity producerId with
  // seq = outbox.id would 409 the first time another entity's row
  // interleaves. Each row is its own single-append producer; retries
  // replay the same triple and dedupe server-side as 204.
  private async publishRow(row: TagStreamOutboxRow): Promise<void> {
    const event = buildTagChangeEvent(row)
    const streamClient = await this.streamClientForTenant(row.tenantId)
    await streamClient.appendWithProducerHeaders(
      `${row.entityUrl}/main`,
      JSON.stringify(event),
      {
        producerId: `tag-outbox-${row.id}`,
        epoch: 0,
        seq: 0,
      }
    )
    await this.registry.deleteTagOutboxRow(row.id, row.tenantId)
  }

  private async handlePublishFailure(
    row: TagStreamOutboxRow,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    if (isUnregisteredTenantError(error)) {
      await this.registry.releaseTagOutboxClaims(this.workerId, row.tenantId)
      serverLog.warn(
        `[tag-outbox] skipped row ${row.id} for unregistered tenant "${row.tenantId}": ${message}`
      )
      return
    }

    const result = await this.registry.failTagOutboxRow(
      row.id,
      this.workerId,
      message,
      MAX_FAILURE_ATTEMPTS,
      row.tenantId
    )

    const logLine = `[tag-outbox] row ${row.id} failed (attempt ${result.attemptCount}/${MAX_FAILURE_ATTEMPTS})`
    if (result.deadLettered) {
      serverLog.error(`${logLine}; dead-lettered: ${message}`)
      return
    }
    serverLog.warn(`${logLine}: ${message}`)
  }

  private sharedTenantIds(): Array<string> | null {
    if (this.tenantId !== null || !this.tenantIds) return null
    return [...new Set(this.tenantIds())]
  }
}

function buildTagChangeEvent(row: TagStreamOutboxRow): ChangeEvent<unknown> {
  const headers = { timestamp: new Date().toISOString() }

  if (row.op === `delete`) {
    return entityStateSchema.tags.delete({ key: row.key, headers })
  }

  const value = row.rowData ?? { key: row.key, value: `` }
  if (row.op === `insert`) {
    return entityStateSchema.tags.insert({ key: row.key, value, headers })
  }
  return entityStateSchema.tags.update({ key: row.key, value, headers })
}
