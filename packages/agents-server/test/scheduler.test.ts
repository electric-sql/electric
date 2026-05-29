import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/entity-manager'
import { PostgresSchedulerClient, Scheduler } from '../src/scheduler'
import { UnregisteredTenantError } from '../src/tenant'

type QueryCall = {
  sql: string
  values: Array<unknown>
}

function createMockPgClient(opts?: {
  responses?: Array<unknown>
  txResponses?: Array<unknown>
}) {
  const calls: Array<QueryCall> = []
  const txCalls: Array<QueryCall> = []
  const responses = [...(opts?.responses ?? [])]
  const txResponses = [...(opts?.txResponses ?? [])]
  const unlistenMock = vi.fn().mockResolvedValue(undefined)
  const arrayMock = vi.fn(
    (value: Array<unknown>, type?: number) =>
      ({ __postgresArray: true, value, type }) as unknown
  )

  const pgClient = vi.fn(
    async (strings: TemplateStringsArray, ...values: Array<unknown>) => {
      calls.push({ sql: strings.join(`?`), values })
      return (responses.shift() ?? []) as unknown
    }
  ) as any

  pgClient.json = (value: unknown) => value
  pgClient.array = arrayMock
  pgClient.listen = vi
    .fn()
    .mockImplementation(async () => ({ unlisten: unlistenMock }))
  pgClient.begin = vi.fn().mockImplementation(async (cb: (sql: any) => any) => {
    const tx = vi.fn(
      async (strings: TemplateStringsArray, ...values: Array<unknown>) => {
        txCalls.push({ sql: strings.join(`?`), values })
        return (txResponses.shift() ?? []) as unknown
      }
    ) as any
    tx.json = (value: unknown) => value
    tx.array = arrayMock
    return cb(tx)
  })

  return {
    pgClient,
    calls,
    txCalls,
    arrayMock,
    unlistenMock,
  }
}

describe(`Scheduler`, () => {
  it(`provides a tenant-scoped scheduling client without starting a worker`, async () => {
    const mock = createMockPgClient()
    const wake = vi.fn()
    const client = new PostgresSchedulerClient(
      mock.pgClient,
      `svc-coastal-stork`,
      wake
    )

    await client.enqueueDelayedSend(
      { entityUrl: `/chat/test`, payload: `hi` },
      new Date(`2026-04-09T12:00:00.000Z`)
    )

    expect(mock.calls[0]!.sql).toContain(`insert into scheduled_tasks`)
    expect(mock.calls[0]!.values).toContain(`svc-coastal-stork`)
    expect(wake).toHaveBeenCalledOnce()
    expect(mock.pgClient.listen).not.toHaveBeenCalled()
  })

  it(`subscribes to LISTEN on start and unlistens on stop`, async () => {
    const mock = createMockPgClient({
      responses: [[], [], []],
    })
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    await scheduler.start()
    await Promise.resolve()
    await scheduler.stop()

    expect(mock.pgClient.listen).toHaveBeenCalledWith(
      `scheduled_tasks_wake`,
      expect.any(Function)
    )
    expect(mock.unlistenMock).toHaveBeenCalledOnce()
  })

  it(`marks 4xx ElectricAgentsError failures as complete instead of retrying`, async () => {
    const mock = createMockPgClient()
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi
          .fn()
          .mockRejectedValue(
            new ElectricAgentsError(`INVALID_REQUEST`, `bad request`, 422)
          ),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).executeTask({
      id: 7,
      kind: `delayed_send`,
      payload: { entityUrl: `/chat/test`, from: `user`, payload: `hi` },
      fireAt: new Date(`2026-04-09T12:00:00.000Z`),
      cronExpression: null,
      cronTimezone: null,
      cronTickNumber: null,
    })

    expect(
      mock.calls.some((call) =>
        call.sql.includes(`set completed_at = now(), last_error = ?`)
      )
    ).toBe(true)
    expect(
      mock.calls.some((call) =>
        call.sql.includes(`set claimed_at = null, claimed_by = null`)
      )
    ).toBe(false)
  })

  it(`releases transient failures back to the queue`, async () => {
    const mock = createMockPgClient()
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi.fn().mockRejectedValue(new Error(`network down`)),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).executeTask({
      id: 8,
      kind: `delayed_send`,
      payload: { entityUrl: `/chat/test`, from: `user`, payload: `hi` },
      fireAt: new Date(`2026-04-09T12:00:00.000Z`),
      cronExpression: null,
      cronTimezone: null,
      cronTickNumber: null,
    })

    expect(
      mock.calls.some(
        (call) =>
          call.sql.includes(`set claimed_at = null, claimed_by = null`) &&
          call.sql.includes(`and claimed_by = ?`)
      )
    ).toBe(true)
    expect(
      mock.calls.some((call) =>
        call.sql.includes(`set completed_at = now(), last_error = ?`)
      )
    ).toBe(false)
  })

  it(`filters shared claims to registered tenant ids`, async () => {
    const mock = createMockPgClient({
      responses: [
        [
          {
            id: 3,
            tenant_id: `svc-a`,
            kind: `delayed_send`,
            payload: { entityUrl: `/chat/test`, payload: `hi` },
            fire_at: new Date(`2026-04-09T12:00:00.000Z`),
            cron_expression: null,
            cron_timezone: null,
            cron_tick_number: null,
            owner_entity_url: null,
            manifest_key: null,
          },
        ],
      ],
    })
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      tenantId: null,
      tenantIds: () => [`svc-a`, `svc-b`],
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    const tasks = await (scheduler as any).claimReadyTasks()

    expect(tasks).toHaveLength(1)
    expect(mock.calls[0]!.sql).toContain(`tenant_id = any(?)`)
    expect(mock.calls[0]!.sql).not.toContain(`::text[]`)
    expect(mock.arrayMock).toHaveBeenCalledWith([`svc-a`, `svc-b`], 25)
    expect(mock.calls[0]!.values).toContain(
      mock.arrayMock.mock.results[0]!.value
    )
  })

  it(`uses typed postgres arrays for shared stale claim reclaim`, async () => {
    const mock = createMockPgClient()
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      tenantId: null,
      tenantIds: () => [`svc-a`, `svc-b`],
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).reclaimStaleClaims()

    expect(mock.calls[0]!.sql).toContain(`tenant_id = any(?)`)
    expect(mock.calls[0]!.sql).not.toContain(`::text[]`)
    expect(mock.arrayMock).toHaveBeenCalledWith([`svc-a`, `svc-b`], 25)
  })

  it(`uses typed postgres arrays for shared next-fire lookup`, async () => {
    const mock = createMockPgClient({ responses: [[]] })
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      tenantId: null,
      tenantIds: () => [`svc-a`, `svc-b`],
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).getNextFireAt()

    expect(mock.calls[0]!.sql).toContain(`tenant_id = any(?)`)
    expect(mock.calls[0]!.sql).not.toContain(`::text[]`)
    expect(mock.arrayMock).toHaveBeenCalledWith([`svc-a`, `svc-b`], 25)
  })

  it(`does not claim shared tasks when no tenants are registered`, async () => {
    const mock = createMockPgClient()
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      tenantId: null,
      tenantIds: () => [],
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    const tasks = await (scheduler as any).claimReadyTasks()

    expect(tasks).toEqual([])
    expect(mock.calls).toHaveLength(0)
  })

  it(`soft-skips tasks for tenants missing during execution`, async () => {
    const mock = createMockPgClient()
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi
          .fn()
          .mockRejectedValue(
            new UnregisteredTenantError(`svc-missing`, `scheduler`)
          ),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).executeTask({
      id: 12,
      tenantId: `svc-missing`,
      kind: `delayed_send`,
      payload: { entityUrl: `/chat/test`, from: `user`, payload: `hi` },
      fireAt: new Date(`2026-04-09T12:00:00.000Z`),
      cronExpression: null,
      cronTimezone: null,
      cronTickNumber: null,
    })

    expect(
      mock.calls.some(
        (call) =>
          call.sql.includes(`set claimed_at = null, claimed_by = null`) &&
          call.values.includes(`svc-missing`)
      )
    ).toBe(true)
    expect(
      mock.calls.some((call) =>
        call.sql.includes(`set completed_at = now(), last_error = ?`)
      )
    ).toBe(false)
  })

  it(`reschedules cron from the stored fireAt instead of now`, async () => {
    const mock = createMockPgClient({
      txResponses: [[{ id: 11 }], []],
    })
    const scheduler = new Scheduler({
      pgClient: mock.pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })

    await (scheduler as any).completeAndRescheduleCron({
      id: 11,
      kind: `cron_tick`,
      payload: { streamPath: `/_cron/test` },
      fireAt: new Date(`2026-04-09T10:00:00.000Z`),
      cronExpression: `*/30 * * * *`,
      cronTimezone: `UTC`,
      cronTickNumber: 4,
    })

    const insertCall = mock.txCalls.find((call) =>
      call.sql.includes(`insert into scheduled_tasks`)
    )
    expect(insertCall).toBeDefined()
    expect(insertCall!.values[0]).toBe(`default`)
    expect(insertCall!.values[3]).toBe(`*/30 * * * *`)
    expect(insertCall!.values[4]).toBe(`UTC`)
    expect(insertCall!.values[5]).toBe(5)
    expect(insertCall!.values[2]).toBe(`2026-04-09T10:30:00.000Z`)
  })

  it(`recovers from transient run loop errors instead of stopping permanently`, async () => {
    const scheduler = new Scheduler({
      pgClient: createMockPgClient().pgClient,
      instanceId: `instance-1`,
      executors: {
        delayed_send: vi.fn(),
        cron_tick: vi.fn(),
      },
    })
    const reclaimStaleClaims = vi
      .spyOn(scheduler as any, `reclaimStaleClaims`)
      .mockRejectedValueOnce(new Error(`db unavailable`))
    const fireReadyTasks = vi.spyOn(scheduler as any, `fireReadyTasks`)
    const sleepOrWake = vi
      .spyOn(scheduler as any, `sleepOrWake`)
      .mockImplementation(async () => {
        ;(scheduler as any).running = false
      })
    const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {})

    ;(scheduler as any).running = true
    await (scheduler as any).runLoop()

    expect(reclaimStaleClaims).toHaveBeenCalledOnce()
    expect(fireReadyTasks).not.toHaveBeenCalled()
    expect(sleepOrWake).toHaveBeenCalledWith(10_000)
    expect(errorSpy).toHaveBeenCalledWith(
      `[agent-server] scheduler iteration failed:`,
      expect.any(Error)
    )

    errorSpy.mockRestore()
  })
})
