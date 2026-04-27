import { randomUUID } from 'node:crypto'
import { entityStateSchema } from '@electric-ax/agents-runtime'
import { serverLog } from './log.js'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  PostgresRegistry,
  TagStreamOutboxRow,
} from './electric-agents-registry.js'
import type { StreamClient } from './stream-client.js'

const DRAIN_INTERVAL_MS = 500
const MAX_FAILURE_ATTEMPTS = 10

export class TagStreamOutboxDrainer {
  private timer: NodeJS.Timeout | null = null
  private draining = false
  private activeDrain: Promise<void> | null = null
  private stopping = false
  private workerId = randomUUID()

  constructor(
    private registry: PostgresRegistry,
    private streamClient: StreamClient
  ) {}

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
      await this.registry.releaseTagOutboxClaims(this.workerId)
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
      const rows = await this.registry.claimTagOutboxRows(this.workerId)
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

  // Per-row producer identity (producerId = tag-outbox-${row.id}, epoch=0,
  // seq=0) is deliberate: the protocol requires same-epoch seqs to be
  // contiguous (PROTOCOL.md), so a shared per-entity producerId with
  // seq = outbox.id would 409 the first time another entity's row
  // interleaves. Each row is its own single-append producer; retries
  // replay the same triple and dedupe server-side as 204.
  private async publishRow(row: TagStreamOutboxRow): Promise<void> {
    const event = buildTagChangeEvent(row)
    await this.streamClient.appendWithProducerHeaders(
      `${row.entityUrl}/main`,
      JSON.stringify(event),
      {
        producerId: `tag-outbox-${row.id}`,
        epoch: 0,
        seq: 0,
      }
    )
    await this.registry.deleteTagOutboxRow(row.id)
  }

  private async handlePublishFailure(
    row: TagStreamOutboxRow,
    error: unknown
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    const result = await this.registry.failTagOutboxRow(
      row.id,
      this.workerId,
      message,
      MAX_FAILURE_ATTEMPTS
    )

    const logLine = `[tag-outbox] row ${row.id} failed (attempt ${result.attemptCount}/${MAX_FAILURE_ATTEMPTS})`
    if (result.deadLettered) {
      serverLog.error(`${logLine}; dead-lettered: ${message}`)
      return
    }
    serverLog.warn(`${logLine}: ${message}`)
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
