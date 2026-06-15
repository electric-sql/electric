import { getNextCronFireAt } from '@electric-ax/agents-runtime'
import { DEFAULT_TENANT_ID, isUnregisteredTenantError } from './tenant.js'
import { serverLog } from './utils/log.js'
import type { PgClient } from './db/index.js'

export interface DelayedSendPayload {
  entityUrl: string
  from?: string
  from_principal?: string
  from_agent?: string
  payload: unknown
  key?: string
  type?: string
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
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
type TenantIdsProvider = () => Iterable<string>
const POSTGRES_TEXT_OID = 25

interface ScheduledTaskRow {
  id: number | string
  tenant_id: string
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
  tenantId?: string | null
  tenantIds?: TenantIdsProvider
  claimExpiryMs?: number
  safetyPollMs?: number
  listen?: boolean
  executors: {
    delayed_send: (
      payload: DelayedSendPayload,
      taskId: number,
      tenantId: string
    ) => Promise<void>
    cron_tick: (
      payload: CronTickPayload,
      tickNumber: number,
      taskId: number,
      tenantId: string
    ) => Promise<void>
  }
}

export interface SchedulerClient {
  enqueueDelayedSend(
    payload: DelayedSendPayload,
    fireAt: Date,
    opts?: { ownerEntityUrl?: string; manifestKey?: string }
  ): Promise<void>
  syncManifestDelayedSend(
    ownerEntityUrl: string,
    manifestKey: string,
    payload: DelayedSendPayload,
    fireAt: Date
  ): Promise<void>
  cancelManifestDelayedSend(
    ownerEntityUrl: string,
    manifestKey: string
  ): Promise<void>
  enqueueCronTick(
    expression: string,
    timezone: string,
    tickNumber: number,
    streamPath: string,
    fireAt: Date
  ): Promise<void>
}

export class PostgresSchedulerClient implements SchedulerClient {
  constructor(
    private readonly pgClient: PgClient,
    private readonly tenantId: string,
    private readonly wake?: () => void
  ) {}

  async enqueueDelayedSend(
    payload: DelayedSendPayload,
    fireAt: Date,
    opts?: { ownerEntityUrl?: string; manifestKey?: string }
  ): Promise<void> {
    await this.pgClient`
      insert into scheduled_tasks (
        tenant_id,
        kind,
        payload,
        fire_at,
        owner_entity_url,
        manifest_key
      )
      values (
        ${this.tenantId},
        'delayed_send',
        ${JSON.stringify(payload)}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${opts?.ownerEntityUrl ?? null},
        ${opts?.manifestKey ?? null}
      )
    `
    this.wake?.()
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
        where tenant_id = ${this.tenantId}
          and kind = 'delayed_send'
          and owner_entity_url = ${ownerEntityUrl}
          and manifest_key = ${manifestKey}
          and completed_at is null
      `

      await sql`
        insert into scheduled_tasks (
          tenant_id,
          kind,
          payload,
          fire_at,
          owner_entity_url,
          manifest_key
        )
        values (
          ${this.tenantId},
          'delayed_send',
          ${JSON.stringify(payload)}::jsonb,
          ${fireAt.toISOString()}::timestamptz,
          ${ownerEntityUrl},
          ${manifestKey}
        )
      `
    })
    this.wake?.()
  }

  async cancelManifestDelayedSend(
    ownerEntityUrl: string,
    manifestKey: string
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), claimed_at = null, claimed_by = null
      where tenant_id = ${this.tenantId}
        and kind = 'delayed_send'
        and owner_entity_url = ${ownerEntityUrl}
        and manifest_key = ${manifestKey}
        and completed_at is null
    `
    this.wake?.()
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
        tenant_id,
        kind,
        payload,
        fire_at,
        cron_expression,
        cron_timezone,
        cron_tick_number
      )
      values (
        ${this.tenantId},
        'cron_tick',
        ${JSON.stringify({ streamPath })}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${expression},
        ${timezone},
        ${tickNumber}
      )
      on conflict (tenant_id, cron_expression, cron_timezone, cron_tick_number) do nothing
    `
    this.wake?.()
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

function cronTaskStreamPath(
  payload: DelayedSendPayload | CronTickPayload
): string | null {
  return typeof (payload as { streamPath?: unknown }).streamPath === `string`
    ? (payload as { streamPath: string }).streamPath
    : null
}

function normalizeTask(row: ScheduledTaskRow): {
  id: number
  tenantId: string
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
    tenantId: row.tenant_id,
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

export class Scheduler implements SchedulerClient {
  private readonly claimExpiryMs: number
  private readonly safetyPollMs: number
  private readonly listenEnabled: boolean
  private readonly pgClient: PgClient
  private readonly instanceId: string
  private readonly tenantId: string | null
  private readonly tenantIds?: TenantIdsProvider
  private running = false
  private loopPromise: Promise<void> | null = null
  private currentSleepResolve: (() => void) | null = null
  private currentSleepTimer: NodeJS.Timeout | null = null
  private listenerMeta: { unlisten: () => Promise<void> } | null = null

  constructor(private readonly options: SchedulerOptions) {
    this.pgClient = options.pgClient
    this.instanceId = options.instanceId
    this.tenantId =
      options.tenantId === undefined ? DEFAULT_TENANT_ID : options.tenantId
    this.tenantIds = options.tenantIds
    this.claimExpiryMs = options.claimExpiryMs ?? 30_000
    this.safetyPollMs = options.safetyPollMs ?? 10_000
    this.listenEnabled = options.listen !== false
  }

  private resolveTenantId(tenantId?: string): string {
    if (tenantId) return tenantId
    if (this.tenantId) return this.tenantId
    throw new Error(`Scheduler tenantId is required in shared mode`)
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

  wake(): void {
    this.wakeEarly()
  }

  async enqueueDelayedSend(
    payload: DelayedSendPayload,
    fireAt: Date,
    opts?: { ownerEntityUrl?: string; manifestKey?: string }
  ): Promise<void> {
    const tenantId = this.resolveTenantId()
    await this.pgClient`
      insert into scheduled_tasks (
        tenant_id,
        kind,
        payload,
        fire_at,
        owner_entity_url,
        manifest_key
      )
      values (
        ${tenantId},
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
    const tenantId = this.resolveTenantId()
    await this.pgClient.begin(async (sql) => {
      await sql`
        update scheduled_tasks
        set completed_at = now(), claimed_at = null, claimed_by = null
        where tenant_id = ${tenantId}
          and kind = 'delayed_send'
          and owner_entity_url = ${ownerEntityUrl}
          and manifest_key = ${manifestKey}
          and completed_at is null
      `

      await sql`
        insert into scheduled_tasks (
          tenant_id,
          kind,
          payload,
          fire_at,
          owner_entity_url,
          manifest_key
        )
        values (
          ${tenantId},
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
    const tenantId = this.resolveTenantId()
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), claimed_at = null, claimed_by = null
      where tenant_id = ${tenantId}
        and kind = 'delayed_send'
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
    const tenantId = this.resolveTenantId()
    await this.pgClient`
      insert into scheduled_tasks (
        tenant_id,
        kind,
        payload,
        fire_at,
        cron_expression,
        cron_timezone,
        cron_tick_number
      )
      values (
        ${tenantId},
        'cron_tick',
        ${JSON.stringify({ streamPath })}::jsonb,
        ${fireAt.toISOString()}::timestamptz,
        ${expression},
        ${timezone},
        ${tickNumber}
      )
      on conflict (tenant_id, cron_expression, cron_timezone, cron_tick_number) do nothing
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
    if (this.tenantId === null) {
      const tenantIds = this.sharedTenantIds()
      if (tenantIds && tenantIds.length === 0) return
      if (tenantIds) {
        await this.pgClient`
          update scheduled_tasks
          set claimed_by = null, claimed_at = null
          where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
            and completed_at is null
            and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
        `
        return
      }

      await this.pgClient`
        update scheduled_tasks
        set claimed_by = null, claimed_at = null
        where completed_at is null
          and claimed_at < now() - (${this.claimExpiryMs} * interval '1 millisecond')
      `
      return
    }

    await this.pgClient`
      update scheduled_tasks
      set claimed_by = null, claimed_at = null
      where tenant_id = ${this.tenantId}
        and completed_at is null
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
    if (this.tenantId === null) {
      const tenantIds = this.sharedTenantIds()
      if (tenantIds && tenantIds.length === 0) return []
      if (tenantIds) {
        const rows = await this.pgClient<Array<ScheduledTaskRow>>`
          update scheduled_tasks
          set claimed_by = ${this.instanceId}, claimed_at = now()
          where id in (
            select id
            from scheduled_tasks
            where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
              and completed_at is null
              and claimed_at is null
              and fire_at <= now()
            order by fire_at, id
            for update skip locked
            limit 50
          )
          returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
            , owner_entity_url, manifest_key
        `

        return rows.map(normalizeTask)
      }

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
        returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
          , owner_entity_url, manifest_key
      `

      return rows.map(normalizeTask)
    }

    const rows = await this.pgClient<Array<ScheduledTaskRow>>`
      update scheduled_tasks
      set claimed_by = ${this.instanceId}, claimed_at = now()
      where tenant_id = ${this.tenantId}
        and id in (
        select id
        from scheduled_tasks
        where tenant_id = ${this.tenantId}
          and completed_at is null
          and claimed_at is null
          and fire_at <= now()
        order by fire_at, id
        for update skip locked
        limit 50
      )
      returning tenant_id, id, kind, payload, fire_at, cron_expression, cron_timezone, cron_tick_number
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
          task.id,
          task.tenantId
        )
        await this.markTaskComplete(task.id, task.tenantId)
        return
      }

      const tickNumber = task.cronTickNumber
      if (tickNumber == null || !task.cronExpression || !task.cronTimezone) {
        throw new Error(`cron task ${task.id} is missing cron metadata`)
      }

      await this.options.executors.cron_tick(
        task.payload as CronTickPayload,
        tickNumber,
        task.id,
        task.tenantId
      )
      await this.completeAndRescheduleCron(task)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isUnregisteredTenantError(err)) {
        await this.releaseClaim(task.id, message, task.tenantId)
        serverLog.warn(
          `[scheduler] skipped ${task.kind} task ${task.id} for unregistered tenant "${task.tenantId}": ${message}`
        )
        return
      }
      if (isPermanentElectricAgentsError(err)) {
        await this.markTaskPermanentFailure(task.id, message, task.tenantId)
        return
      }
      await this.releaseClaim(task.id, message, task.tenantId)
    }
  }

  private async markTaskComplete(
    taskId: number,
    tenantId = this.resolveTenantId()
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = null
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async markTaskPermanentFailure(
    taskId: number,
    message: string,
    tenantId = this.resolveTenantId()
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set completed_at = now(), last_error = ${message}
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async releaseClaim(
    taskId: number,
    message: string,
    tenantId = this.resolveTenantId()
  ): Promise<void> {
    await this.pgClient`
      update scheduled_tasks
      set claimed_at = null, claimed_by = null, last_error = ${message}
      where tenant_id = ${tenantId}
        and id = ${taskId}
        and claimed_by = ${this.instanceId}
        and completed_at is null
    `
  }

  private async completeAndRescheduleCron(
    task: ReturnType<typeof normalizeTask>
  ): Promise<void> {
    const tenantId = task.tenantId ?? this.resolveTenantId()
    await this.pgClient.begin(async (sql) => {
      const completed = await sql<Array<{ id: number | string }>>`
        update scheduled_tasks
        set completed_at = now(), last_error = null
        where tenant_id = ${tenantId}
          and id = ${task.id}
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

      const streamPath = cronTaskStreamPath(task.payload)
      const subscriberRows = streamPath
        ? await sql<Array<{ exists: number }>>`
            select 1 as exists
            from wake_registrations
            where tenant_id = ${tenantId}
              and source_url = ${streamPath}
            limit 1
          `
        : []

      // Cron streams are virtual shared sources. If no wake registrations
      // still point at this cron stream (e.g. the owning manifest schedule was
      // deleted), stop the chain here instead of keeping a forever-global tick
      // alive. Rehydration/getOrCreateCronStream will seed a fresh tick when a
      // subscription is recreated.
      if (subscriberRows.length === 0) return

      await sql`
        insert into scheduled_tasks (
          tenant_id,
          kind,
          payload,
          fire_at,
          cron_expression,
          cron_timezone,
          cron_tick_number
        )
        values (
          ${tenantId},
          'cron_tick',
          ${JSON.stringify(task.payload)}::jsonb,
          ${nextFireAt.toISOString()}::timestamptz,
          ${task.cronExpression},
          ${task.cronTimezone},
          ${task.cronTickNumber! + 1}
        )
        on conflict (tenant_id, cron_expression, cron_timezone, cron_tick_number) do nothing
      `
    })
  }

  private async getNextFireAt(): Promise<Date | null> {
    if (this.tenantId === null) {
      const tenantIds = this.sharedTenantIds()
      if (tenantIds && tenantIds.length === 0) return null
      if (tenantIds) {
        const rows = await this.pgClient<Array<{ fire_at: Date | string }>>`
          select fire_at
          from scheduled_tasks
          where tenant_id = any(${this.sharedTenantIdsParameter(tenantIds)})
            and completed_at is null
            and claimed_at is null
          order by fire_at, id
          limit 1
        `

        if (rows.length === 0) return null
        const fireAt = rows[0]!.fire_at
        return fireAt instanceof Date ? fireAt : new Date(fireAt)
      }

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

    const rows = await this.pgClient<Array<{ fire_at: Date | string }>>`
      select fire_at
      from scheduled_tasks
      where tenant_id = ${this.tenantId}
        and completed_at is null
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

  private sharedTenantIds(): Array<string> | null {
    if (this.tenantId !== null || !this.tenantIds) return null
    return [...new Set(this.tenantIds())]
  }

  private sharedTenantIdsParameter(tenantIds: Array<string>) {
    return this.pgClient.array(tenantIds, POSTGRES_TEXT_OID)
  }
}
