import { describe, expect, it, vi } from 'vitest'
import { createHandlerContext } from '../src/context-factory'
import { ENTITY_COLLECTIONS } from '../src/entity-schema'
import { createLocalOnlyTestCollection } from './helpers/local-only'
import type { EntityStreamDBWithActions } from '../src/types'
import type { ChangeEvent } from '@durable-streams/state'

interface RecordRunHarness {
  recordRun: ReturnType<
    NonNullable<ReturnType<typeof createHandlerContext>>[`ctx`][`recordRun`]
  > extends infer R
    ? () => R
    : never
  writeEvent: ReturnType<typeof vi.fn>
}

function buildHarness(opts?: { existingRunKeys?: Array<string> }): {
  ctx: ReturnType<typeof createHandlerContext>[`ctx`]
  writeEvent: ReturnType<typeof vi.fn>
} {
  const collections: Record<string, unknown> = {}
  for (const [name] of Object.entries(ENTITY_COLLECTIONS)) {
    if (name === `runs`) continue
    collections[name] = createLocalOnlyTestCollection([], {
      id: `test-${name}`,
    })
  }
  collections.runs = createLocalOnlyTestCollection(
    (opts?.existingRunKeys ?? []).map((key) => ({ key, status: `completed` })),
    { id: `test-runs` }
  )

  const db = {
    collections,
    actions: {},
    close: () => {},
    utils: {
      awaitTxId: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as EntityStreamDBWithActions

  const writeEvent = vi.fn()

  const { ctx } = createHandlerContext({
    entityUrl: `/test/entity`,
    entityType: `test`,
    epoch: 1,
    wakeOffset: `-1`,
    firstWake: false,
    args: {},
    db,
    state: {},
    actions: {},
    electricTools: [],
    events: [] as Array<ChangeEvent>,
    writeEvent,
    wakeSession: {
      getPhase: () => `active`,
      registerManifestEntry: vi.fn(() => true),
      removeManifestEntry: vi.fn(() => false),
      commitManifestEntries: vi.fn(),
      rollbackManifestEntries: vi.fn(),
      registerSharedStateHandle: vi.fn(),
      registerSpawnHandle: vi.fn(),
      registerSourceHandle: vi.fn(),
      enqueueSend: vi.fn(),
      getManifest: vi.fn(() => []),
      getPendingSends: vi.fn(() => []),
      getSharedStateHandles: vi.fn(() => new Map()),
      getSpawnHandles: vi.fn(() => new Map()),
      getSourceHandles: vi.fn(() => new Map()),
      finishSetup: vi.fn(() => ({
        manifest: [],
        sharedStateHandles: new Map(),
        spawnHandles: new Map(),
        sourceHandles: new Map(),
      })),
      close: vi.fn(),
    } as any,
    wakeEvent: {
      type: `wake`,
      source: `/test/entity/main`,
      fromOffset: 0,
      toOffset: 0,
      eventCount: 0,
      payload: undefined,
    },
    doObserve: vi.fn(),
    doSpawn: vi.fn(),
    doMkdb: vi.fn(),
    executeSend: vi.fn(),
    tags: {},
    doSetTag: vi.fn().mockResolvedValue(undefined),
    doRemoveTag: vi.fn().mockResolvedValue(undefined),
  })

  return { ctx, writeEvent }
}

describe(`ctx.recordRun()`, () => {
  it(`returns run-0 and writes a runs.insert with status=started when no prior runs`, () => {
    const { ctx, writeEvent } = buildHarness()
    const handle = ctx.recordRun()

    expect(handle.key).toBe(`run-0`)
    expect(writeEvent).toHaveBeenCalledTimes(1)
    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect(ev.type).toBe(`run`)
    expect(ev.key).toBe(`run-0`)
    expect((ev.value as { status: string }).status).toBe(`started`)
    expect((ev.headers as { operation: string }).operation).toBe(`insert`)
  })

  it(`seeds the counter from existing runs in db.collections.runs.toArray`, () => {
    const { ctx, writeEvent } = buildHarness({
      existingRunKeys: [`run-2`, `run-0`, `run-1`],
    })
    const handle = ctx.recordRun()

    expect(handle.key).toBe(`run-3`)
    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect(ev.key).toBe(`run-3`)
  })

  it(`produces monotonic keys across sequential calls within one handler invocation`, () => {
    const { ctx } = buildHarness()
    const a = ctx.recordRun()
    const b = ctx.recordRun()
    const c = ctx.recordRun()

    expect(a.key).toBe(`run-0`)
    expect(b.key).toBe(`run-1`)
    expect(c.key).toBe(`run-2`)
  })
})

describe(`RunHandle.end({status, finishReason?})`, () => {
  it(`writes a runs.update with status=completed and finish_reason=stop by default`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.end({ status: `completed` })

    expect(writeEvent).toHaveBeenCalledTimes(1)
    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect(ev.type).toBe(`run`)
    expect(ev.key).toBe(run.key)
    expect((ev.headers as { operation: string }).operation).toBe(`update`)
    expect(ev.value as { status: string; finish_reason: string }).toEqual({
      status: `completed`,
      finish_reason: `stop`,
    })
  })

  it(`defaults finish_reason to "error" for status=failed`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.end({ status: `failed` })

    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect((ev.value as { finish_reason: string }).finish_reason).toBe(`error`)
  })

  it(`honors an explicit finishReason override`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.end({ status: `completed`, finishReason: `tool_calls` })

    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect((ev.value as { finish_reason: string }).finish_reason).toBe(
      `tool_calls`
    )
  })
})

describe(`RunHandle.attachResponse(text)`, () => {
  it(`writes a text_deltas.insert linked to the run by id and key`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.attachResponse(`hello there`)

    expect(writeEvent).toHaveBeenCalledTimes(1)
    const ev = writeEvent.mock.calls[0]![0] as ChangeEvent
    expect(ev.type).toBe(`text_delta`)
    expect(ev.key).toBe(`${run.key}:delta-0`)
    expect((ev.headers as { operation: string }).operation).toBe(`insert`)
    expect(ev.value).toEqual({
      text_id: run.key,
      run_id: run.key,
      delta: `hello there`,
    })
  })

  it(`assigns monotonically increasing delta keys for the same run`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.attachResponse(`first`)
    run.attachResponse(`second`)
    run.attachResponse(`third`)

    expect(writeEvent.mock.calls.map((c) => (c[0] as ChangeEvent).key)).toEqual(
      [`${run.key}:delta-0`, `${run.key}:delta-1`, `${run.key}:delta-2`]
    )
  })

  it(`uses an independent delta counter per RunHandle`, () => {
    const { ctx, writeEvent } = buildHarness()
    const a = ctx.recordRun()
    const b = ctx.recordRun()
    writeEvent.mockClear()

    a.attachResponse(`a-first`)
    b.attachResponse(`b-first`)
    a.attachResponse(`a-second`)

    expect(writeEvent.mock.calls.map((c) => (c[0] as ChangeEvent).key)).toEqual(
      [`${a.key}:delta-0`, `${b.key}:delta-0`, `${a.key}:delta-1`]
    )
  })

  it(`is a no-op for empty strings and non-string args`, () => {
    const { ctx, writeEvent } = buildHarness()
    const run = ctx.recordRun()
    writeEvent.mockClear()

    run.attachResponse(``)
    run.attachResponse(undefined as unknown as string)
    run.attachResponse(123 as unknown as string)

    expect(writeEvent).not.toHaveBeenCalled()
  })
})

// Suppress unused-export warning — type kept for documentation purposes.
export type { RecordRunHarness }
