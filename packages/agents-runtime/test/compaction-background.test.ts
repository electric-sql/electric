import { describe, expect, it } from 'vitest'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'

function seedStep(
  db: ReturnType<typeof buildStreamFixture>,
  contextInputTokens: number
): void {
  ;(
    db.collections as unknown as { steps: { insert: (r: unknown) => void } }
  ).steps.insert({
    key: `step-1`,
    _seq: 1,
    run_id: `r`,
    step_number: 1,
    status: `completed`,
    context_input_tokens: contextInputTokens,
    context_window: 200000,
  })
}

function compactionAttrs(event: ChangeEvent):
  | {
      kind?: string
      status?: string
      background?: boolean
      watermark?: unknown
    }
  | undefined {
  return (event.value as { attrs?: { kind?: string } } | undefined)
    ?.attrs as never
}

describe(`background compaction (turn-end)`, () => {
  it(`starts when usage is high: summarizes + writes a background running checkpoint`, async () => {
    const db = buildStreamFixture(
      Array.from({ length: 6 }, (_, i) => ({
        kind: `inbox` as const,
        at: i + 1,
        value: { payload: `MSG_${i}` },
      }))
    )
    seedStep(db, 190000) // 95% of the 200k window ≥ 85% background start

    const writes: Array<ChangeEvent> = []
    const res = createTestHandlerContext({
      db,
      writeEvent: (event) => {
        writes.push(event)
        db.utils.applyEvent(event)
      },
    })
    res.ctx.useAgent({
      systemPrompt: `t`,
      model: `claude-sonnet-4-5-20250929`,
      provider: `anthropic`,
      tools: [],
      summarizeComplete: async () => ({
        content: [{ type: `text`, text: `BG_SUMMARY` }],
      }),
    })

    const handle = res.maybeStartBackgroundCompaction()
    expect(handle).not.toBeNull()

    const summary = await handle!.promise
    expect(summary).toContain(`BG_SUMMARY`)

    // A background-flavored running checkpoint was written for the UI.
    const idOf = (e: ChangeEvent): string | undefined =>
      (e.value as { id?: string } | undefined)?.id
    const runningWrite = writes.find((e) => {
      const a = compactionAttrs(e)
      return a?.status === `running` && a?.background === true
    })
    expect(runningWrite).toBeDefined()
    // …under a watermark-unique id, so the NEXT generation's `running` can't
    // supersede this generation's `complete`.
    expect(idOf(runningWrite!)).toBe(`compaction-bg-${handle!.watermark}`)

    // Applying the result writes a complete checkpoint carrying the watermark,
    // under the SAME generation id (so it supersedes its own running row).
    res.writeBackgroundCheckpoint(handle!.watermark, summary)
    const completeWrite = writes.find(
      (e) => compactionAttrs(e)?.status === `complete`
    )
    expect(completeWrite).toBeDefined()
    expect(compactionAttrs(completeWrite!)?.watermark).toBe(handle!.watermark)
    expect(idOf(completeWrite!)).toBe(`compaction-bg-${handle!.watermark}`)
  })

  it(`skips when usage is below the background threshold`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `hi` } },
    ])
    seedStep(db, 50000) // 25%
    const res = createTestHandlerContext({ db })
    res.ctx.useAgent({
      systemPrompt: `t`,
      model: `claude-sonnet-4-5-20250929`,
      provider: `anthropic`,
      tools: [],
    })
    expect(res.maybeStartBackgroundCompaction()).toBeNull()
  })

  it(`skips when already compacted up to the head`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `hi` } },
      {
        kind: `context_inserted`,
        at: 2,
        value: {
          id: `compaction`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `complete`, watermark: 99999 },
          content: `S`,
        },
      },
    ])
    seedStep(db, 190000)
    const res = createTestHandlerContext({ db })
    res.ctx.useAgent({
      systemPrompt: `t`,
      model: `claude-sonnet-4-5-20250929`,
      provider: `anthropic`,
      tools: [],
    })
    expect(res.maybeStartBackgroundCompaction()).toBeNull()
  })
})
