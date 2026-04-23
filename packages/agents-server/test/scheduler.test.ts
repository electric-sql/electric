import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsError } from '../src/electric-agents-manager'
import { Scheduler } from '../src/scheduler'

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

  const pgClient = vi.fn(
    async (strings: TemplateStringsArray, ...values: Array<unknown>) => {
      calls.push({ sql: strings.join(`?`), values })
      return (responses.shift() ?? []) as unknown
    }
  ) as any

  pgClient.json = (value: unknown) => value
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
    return cb(tx)
  })

  return {
    pgClient,
    calls,
    txCalls,
    unlistenMock,
  }
}

describe(`Scheduler`, () => {
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
    expect(insertCall!.values[2]).toBe(`*/30 * * * *`)
    expect(insertCall!.values[3]).toBe(`UTC`)
    expect(insertCall!.values[4]).toBe(5)
    expect(insertCall!.values[1]).toBe(`2026-04-09T10:30:00.000Z`)
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
