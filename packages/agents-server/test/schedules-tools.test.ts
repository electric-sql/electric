import { describe, expect, it, vi } from 'vitest'
import { createScheduleTools } from '../src/electric-agents/tools/schedules'

function createManifestDb(manifests: Array<unknown>) {
  return {
    collections: {
      manifests: {
        get toArray() {
          return manifests
        },
      },
    },
    utils: {
      awaitTxId: vi.fn<(txid: string, timeout?: number) => Promise<void>>(),
    },
  } as any
}

describe(`schedule tools`, () => {
  it(`list_schedules includes stored payloads`, async () => {
    const db = createManifestDb([
      {
        key: `schedule:daily_morning_message`,
        kind: `schedule`,
        id: `daily_morning_message`,
        scheduleType: `cron`,
        expression: `0 8 * * *`,
        payload: `send your user a cherry message`,
        wake: { on: `change` },
      },
    ])

    const tools = createScheduleTools({
      entityUrl: `/chat/test`,
      args: {},
      db,
      upsertCronSchedule: vi.fn(),
      upsertFutureSendSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    })
    const tool = tools.find((entry) => entry.name === `list_schedules`)

    expect(tool).toBeDefined()

    const result = await tool!.execute(`tool-list`, {})
    const firstContent = result.content[0]

    expect(firstContent?.type).toBe(`text`)
    expect(
      firstContent && `text` in firstContent ? firstContent.text : ``
    ).toContain(`"payload": "send your user a cherry message"`)
  })

  it(`upsert_cron_schedule infers timezone from args when omitted`, async () => {
    const manifests: Array<Record<string, unknown>> = []
    const db = createManifestDb(manifests)
    const upsertCronSchedule = vi
      .fn<
        (opts: {
          id: string
          expression: string
          timezone?: string
          payload?: unknown
          debounceMs?: number
          timeoutMs?: number
        }) => Promise<{ txid: string }>
      >()
      .mockResolvedValue({ txid: `tx-cron-1` })

    db.utils.awaitTxId.mockImplementation(async (txid: string) => {
      expect(txid).toBe(`tx-cron-1`)
      manifests.splice(0, manifests.length, {
        key: `schedule:daily_morning_message`,
        kind: `schedule`,
        id: `daily_morning_message`,
        scheduleType: `cron`,
        expression: `0 8 * * *`,
        timezone: `America/Denver`,
        payload: `send your user a cherry message`,
        wake: {
          on: `change`,
          debounceMs: 1_000,
        },
      })
    })

    const tools = createScheduleTools({
      entityUrl: `/chat/test`,
      args: { timezone: `America/Denver` },
      db,
      upsertCronSchedule,
      upsertFutureSendSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
    })
    const tool = tools.find((entry) => entry.name === `upsert_cron_schedule`)

    expect(tool).toBeDefined()

    const result = await tool!.execute(`tool-cron`, {
      id: `daily_morning_message`,
      expression: `0 8 * * *`,
      payload: `send your user a cherry message`,
      debounceMs: 1_000,
    })
    const firstContent = result.content[0]

    expect(upsertCronSchedule).toHaveBeenCalledWith({
      id: `daily_morning_message`,
      expression: `0 8 * * *`,
      timezone: `America/Denver`,
      payload: `send your user a cherry message`,
      debounceMs: 1_000,
      timeoutMs: undefined,
    })
    expect(db.utils.awaitTxId).toHaveBeenCalledWith(`tx-cron-1`, 10_000)
    expect(firstContent?.type).toBe(`text`)
    expect(
      firstContent && `text` in firstContent ? firstContent.text : ``
    ).toContain(`"payload": "send your user a cherry message"`)
  })

  it(`upsert_future_send waits for txid and returns synced manifest state`, async () => {
    const manifests: Array<Record<string, unknown>> = []
    const db = createManifestDb(manifests)
    const upsertFutureSendSchedule = vi
      .fn<
        (opts: {
          id: string
          payload: unknown
          targetUrl?: string
          fireAt: string
          from?: string
          messageType?: string
        }) => Promise<{ txid: string }>
      >()
      .mockResolvedValue({ txid: `tx-future-1` })

    db.utils.awaitTxId.mockImplementation(async (txid: string) => {
      expect(txid).toBe(`tx-future-1`)
      manifests.splice(0, manifests.length, {
        key: `schedule:say_hi`,
        kind: `schedule`,
        id: `say_hi`,
        scheduleType: `future_send`,
        fireAt: `2026-04-10T02:30:00.000Z`,
        targetUrl: `/chat/test`,
        payload: { text: `hi` },
        producerId: `future-send-server`,
        status: `pending`,
      })
    })

    const tools = createScheduleTools({
      entityUrl: `/chat/test`,
      args: {},
      db,
      upsertCronSchedule: vi.fn(),
      upsertFutureSendSchedule,
      deleteSchedule: vi.fn(),
    })
    const tool = tools.find((entry) => entry.name === `upsert_future_send`)

    expect(tool).toBeDefined()

    const result = await tool!.execute(`tool-1`, {
      id: `say_hi`,
      payload: { text: `hi` },
      afterMs: 60_000,
    })
    const firstContent = result.content[0]

    expect(upsertFutureSendSchedule).toHaveBeenCalledTimes(1)
    expect(db.utils.awaitTxId).toHaveBeenCalledWith(`tx-future-1`, 10_000)
    expect(firstContent?.type).toBe(`text`)
    expect(
      firstContent && `text` in firstContent ? firstContent.text : ``
    ).toContain(`"producerId": "future-send-server"`)
  })

  it(`delete_schedule waits for txid after backend delete`, async () => {
    const manifests: Array<Record<string, unknown>> = [
      {
        key: `schedule:say_hi`,
        kind: `schedule`,
        id: `say_hi`,
        scheduleType: `future_send`,
        fireAt: `2026-04-10T02:30:00.000Z`,
        targetUrl: `/chat/test`,
        payload: { text: `hi` },
        producerId: `future-send-server`,
        status: `pending`,
      },
    ]
    const db = createManifestDb(manifests)
    const deleteSchedule = vi
      .fn<(opts: { id: string }) => Promise<{ txid: string }>>()
      .mockResolvedValue({ txid: `tx-delete-1` })

    db.utils.awaitTxId.mockImplementation(async (txid: string) => {
      expect(txid).toBe(`tx-delete-1`)
      manifests.splice(0, manifests.length)
    })

    const tools = createScheduleTools({
      entityUrl: `/chat/test`,
      args: {},
      db,
      upsertCronSchedule: vi.fn(),
      upsertFutureSendSchedule: vi.fn(),
      deleteSchedule,
    })
    const tool = tools.find((entry) => entry.name === `delete_schedule`)

    expect(tool).toBeDefined()

    const result = await tool!.execute(`tool-2`, { id: `say_hi` })
    const firstContent = result.content[0]

    expect(deleteSchedule).toHaveBeenCalledWith({ id: `say_hi` })
    expect(db.utils.awaitTxId).toHaveBeenCalledWith(`tx-delete-1`, 10_000)
    expect(firstContent?.type).toBe(`text`)
    expect(
      firstContent && `text` in firstContent ? firstContent.text : ``
    ).toContain(`"deleted": true`)
  })
})
