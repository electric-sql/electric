import { getNextCronFireAt } from '@electric-ax/agents-runtime'
import type { PgClient } from './db/index.js'

export interface DelayedSendPayload {
  entityUrl: string
  from?: string
  payload: unknown
  key?: string
  type?: string
  producerId?: string
  manifest?: {
    ownerEntityUrl: string
    key: string
    entry: Record<string, unknown>
  }
}

export interface CronTickPayload {
  streamPath: string
}

type SchedulerTaskKind = `delayed_send` | `cron_tick`

interface ScheduledTaskRow {
  id: number | string
  kind: SchedulerTaskKind
  payload: DelayedSendPayload | CronTickPayload
  fire_at: Date | string
  cron_expression: string | null
  cron_timezone: string | null
  cron_tick_number: number | null
  owner_entity_url: string | null
  manifest_key: string | null
}

export interface SchedulerOptions {
  pgClient: PgClient
  instanceId: string
  claimExpiryMs?: number
  safetyPollMs?: number
  listen?: boolean
  executors: {
    delayed_send: (payload: DelayedSendPayload, taskId: number) => Promise<void>
    cron_tick: (
      payload: CronTickPayload,
      tickNumber: number,
      taskId: number
    ) => Promise<void>
  }
}

export function isPermanentElectricAgentsError(err: unknown): boolean {
  const status =
    typeof err === `object` && err !== null && `status` in err
      ? (err as { status?: unknown }).status
      : undefined
  const name =
    typeof err === `object` && err !== null && `name` in err
      ? (err as { name?: unknown }).name
      : undefined

  return (
    name === `ElectricAgentsError` &&
    typeof status === `number` &&
    status >= 400 &&
    status < 500
  )
}

function normalizeTask(row: ScheduledTaskRow): {
  id: number
  kind: SchedulerTaskKind
  payload: DelayedSendPayload | CronTickPayload
  fireAt: Date
  cronExpression: string | null
  cronTimezone: string | null
  cronTickNumber: number | null
  ownerEntityUrl: string | null
  manifestKey: string | null
} {
  return {
    id: Number(row.id),
    kind: row.kind,
    payload: row.payload,
    fireAt: row.fire_at instanceof Date ? row.fire_at : new Date(row.fire_at),
    cronExpression: row.cron_expression,
    cronTimezone: row.cron_timezone,
    cronTickNumber: row.cron_tick_number,
    ownerEntityUrl: row.owner_entity_url,
    manifestKey: row.manifest_key,
  }
}

export class Scheduler {
  private readonly claimExpiryMs: number
  private readonly safetyPollMs: number
  private readonly listenEnabled: boolean
  private readonly pgClient: PgClient
  private readonly instanceId: string
  private running = false
  private loopPromise: Promise<void> | null = null
  private currentSleepResolve: (() => void) | null = null
  private currentSleepTimer: NodeJS.Timeout | null = null
  private listenerMeta: { unlisten: () => Promise<void> } | null = null

  constructor(private readonly options: SchedulerOptions) {
    this.pgClient = options.pgClient
    this.instanceId = options.instanceId
    this.claimExpiryMs = options.claimExpiryMs ?? 30_000
    this.safetyPollMs = options.safetyPollMs ?? 10_000
    this.listenEnabled = options.listen !== false
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    if (this.listenEnabled) {
      this.listenerMeta = await this.pgClient.listen(
        `scheduled_tasks_wake`,
        () => {
          this.wakeEarly()
        }
      )
    }

    this.loopPromise = this.runLoop().catch((err) => {
      console.error(`[agent-server] scheduler loop failed:`, err)
      this.running = false
      this.wakeEarly()
    })
  }

  async stop(): Promise<void> {
    this.running = false
    this.wakeEarly()
    if (this.loopPromise) {
      await this.loopPromise
      this.loopPromise = null
    }
    if (this.listenerMeta) {
      await this.listenerMeta.unlisten()
      this.listenerMeta = null
    }
  }

  async enqueueDelayedSend(
    payload: DelayedSendPayload,
    fireAt: Date,
    opts?: { ownerEntityUrl?: string; manifestKey?: string }
  ): Promise<void> {
    await this.pgClient`
      insert into scheduled_tasks (
        kind,
        payload,
        fire_at,
        owner_entity_url,
        manifest_key
      )
      values (
        'delayed_send',
        ${JSON.stringify(payload)}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${opts?.ownerEntityUrl ?? null},
        ${opts?.manifestKey ?? null}
      )
    `
    this.wakeEarly()
  }

  async syncManifestDelayedSend(
    ownerEntityUrl: string,
    manifestKey: string,
    payload: DelayedSendPayload,
    fireAt: Date
  ): Promise<void> {
    await this.pgClient.begin(async (sql) => {
      await sql`
        update scheduled_tasks
        set completed_at = now(), claimed_at = null, claimed_by = null
        where kind = 'delayed_send'
          and owner_entity_url = ${ownerEntityUrl}
          and manifest_key = ${manifestKey}
          and completed_at is null
      `

      await sql`
        insert into scheduled_tasks (
          kind,
          payload,
          fire_at,
          owner_entity_url,
          manifest_key
        )
        values (
          'delayed_send',
          ${JSON.stringify(payload)}::jsonb,
          ${fireAt.toISOString()}::timestamptz,
          ${ownerEntityUrl},
          ${manifestKey}
        )
      `
    })
    this.wakeEarly()
  }

  async cancelManifestDelayedSend(
    ownerEntityUrl: string,
    manifestKey: string
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), claimed_at = null, claimed_by = null
      where kind = 'delayed_send'
        and owner_entity_url = ${ownerEntityUrl}
        and manifest_key = ${manifestKey}
        and completed_at is null
    `
    this.wakeEarly()
  }

  async enqueueCronTick(
    expression: string,
    timezone: string,
    tickNumber: number,
    streamPath: string,
    fireAt: Date
  ): Promise<void> {
    await this.pgClient`
      insert into scheduled_tasks (
        kind,
        payload,
        fire_at,
        cron_expression,
        cron_timezone,
        cron_tick_number
      )
      values (
        'cron_tick',
        ${JSON.stringify({ streamPath })}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${expression},
        ${timezone},
        ${tickNumber}
      )
      on conflict (cron_expression, cron_timezone, cron_tick_number) do nothing
    `
    this.wakeEarly()
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.reclaimStaleClaims()
        await this.fireReadyTasks()

        const nextFireAt = await this.getNextFireAt()
        const sleepTargetMs = nextFireAt
          ? Math.max(0, nextFireAt.getTime() - Date.now())
          : this.safetyPollMs

        await this.sleepOrWake(Math.min(sleepTargetMs, this.safetyPollMs))
      } catch (err) {
        console.error(`[agent-server] scheduler iteration failed:`, err)
        await this.sleepOrWake(this.safetyPollMs)
      }
    }
  }

  private async reclaimStaleClaims(): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set claimed_by = null, claimed_at = null
      where completed_at is null
        and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
    `
  }

  private async fireReadyTasks(): Promise<void> {
    while (this.running) {
      const tasks = await this.claimReadyTasks()
      if (tasks.length === 0) return

      for (const task of tasks) {
        await this.executeTask(task)
      }
    }
  }

  private async claimReadyTasks(): Promise<
    Array<ReturnType<typeof normalizeTask>>
  > {
    const rows = await this.pgClient<Array<ScheduledTaskRow>>`
      update scheduled_tasks
      set claimed_by = ${this.instanceId}, claimed_at = now()
      where id in (
        select id
        from scheduled_tasks
        where completed_at is null
          and claimed_at is null
          and fire_at <= now()
        order by fire_at, id
        for update skip locked
        limit 50
      )
      returning id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
        , owner_entity_url, manifest_key
    `

    return rows.map(normalizeTask)
  }

  private async executeTask(
    task: ReturnType<typeof normalizeTask>
  ): Promise<void> {
    try {
      if (task.kind === `delayed_send`) {
        await this.options.executors.delayed_send(
          task.payload as DelayedSendPayload,
          task.id
        )
        await this.markTaskComplete(task.id)
        return
      }

      const tickNumber = task.cronTickNumber
      if (tickNumber == null || !task.cronExpression || !task.cronTimezone) {
        throw new Error(`cron task ${task.id} is missing cron metadata`)
      }

      await this.options.executors.cron_tick(
        task.payload as CronTickPayload,
        tickNumber,
        task.id
      )
      await this.completeAndRescheduleCron(task)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isPermanentElectricAgentsError(err)) {
        await this.markTaskPermanentFailure(task.id, message)
        return
      }
      await this.releaseClaim(task.id, message)
    }
  }

  private async markTaskComplete(taskId: number): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = null
      where id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async markTaskPermanentFailure(
    taskId: number,
    message: string
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = ${message}
      where id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async releaseClaim(taskId: number, message: string): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set claimed_at = null, claimed_by = null, last_error = ${message}
      where id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async completeAndRescheduleCron(
    task: ReturnType<typeof normalizeTask>
  ): Promise<void> {
    await this.pgClient.begin(async (sql) => {
      const completed = await sql<Array<{ id: number | string }>>`
        update scheduled_tasks
        set completed_at = now(), last_error = null
        where id = ${task.id}
          and claimed_by = ${this.instanceId}
          and completed_at is null
        returning id
      `
      if (completed.length === 0) return

      const nextFireAt = getNextCronFireAt(
        task.cronExpression!,
        task.cronTimezone!,
        task.fireAt
      )

      await sql`
        insert into scheduled_tasks (
          kind,
          payload,
          fire_at,
          cron_expression,
          cron_timezone,
          cron_tick_number
        )
        values (
          'cron_tick',
          ${JSON.stringify(task.payload)}::jsonb,
          ${nextFireAt.toISOString()}::timestamptz,
          ${task.cronExpression},
          ${task.cronTimezone},
          ${task.cronTickNumber! + 1}
        )
        on conflict (cron_expression, cron_timezone, cron_tick_number) do nothing
      `
    })
  }

  private async getNextFireAt(): Promise<Date | null> {
    const rows = await this.pgClient<Array<{ fire_at: Date | string }>>`
      select fire_at
      from scheduled_tasks
      where completed_at is null
        and claimed_at is null
      order by fire_at, id
      limit 1
    `

    if (rows.length === 0) return null
    const fireAt = rows[0]!.fire_at
    return fireAt instanceof Date ? fireAt : new Date(fireAt)
  }

  private async sleepOrWake(durationMs: number): Promise<void> {
    if (!this.running) return

    await new Promise<void>((resolve) => {
      const finish = (): void => {
        if (this.currentSleepTimer) {
          clearTimeout(this.currentSleepTimer)
          this.currentSleepTimer = null
        }
        this.currentSleepResolve = null
        resolve()
      }

      this.currentSleepResolve = finish
      this.currentSleepTimer = setTimeout(finish, Math.max(durationMs, 0))
    })
  }

  private wakeEarly(): void {
    const resolve = this.currentSleepResolve
    this.currentSleepResolve = null
    if (this.currentSleepTimer) {
      clearTimeout(this.currentSleepTimer)
      this.currentSleepTimer = null
    }
    resolve?.()
  }
}
