import { describe, expect, it } from 'vitest'
import { timelineToMessages } from '../src/timeline-context'
import { buildStreamFixture } from './helpers/context-test-helpers'

function serialize(db: ReturnType<typeof buildStreamFixture>): string {
  return JSON.stringify(timelineToMessages(db))
}

describe(`timelineMessages compaction reconstruction`, () => {
  it(`hides items before a compaction checkpoint and keeps the summary + later items`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      { kind: `inbox`, at: 2, value: { payload: `SECOND_MESSAGE` } },
      {
        kind: `context_inserted`,
        at: 3,
        value: {
          id: `compaction`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `complete` },
          content: `SUMMARY_OF_EARLIER_WORK`,
        },
      },
      { kind: `inbox`, at: 4, value: { payload: `LATEST_MESSAGE` } },
    ])

    const out = serialize(db)
    // Everything before the checkpoint is summarized away…
    expect(out).not.toContain(`FIRST_MESSAGE`)
    expect(out).not.toContain(`SECOND_MESSAGE`)
    // …replaced by the summary, with post-checkpoint messages kept verbatim.
    expect(out).toContain(`SUMMARY_OF_EARLIER_WORK`)
    expect(out).toContain(`LATEST_MESSAGE`)
  })

  it(`places the summary at the stored watermark, before during-compaction messages`, () => {
    // Background compaction snapshotted W=2 (after SECOND), then a prompt+answer
    // arrived (at 3,4) while summarizing, and the checkpoint was written LATE
    // (at 5) with attrs.watermark=2. The summary must render BEFORE the
    // during-compaction messages, not at its physical (late) position.
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      { kind: `inbox`, at: 2, value: { payload: `SECOND_MESSAGE` } },
      { kind: `inbox`, at: 3, value: { payload: `DURING_PROMPT` } },
      { kind: `inbox`, at: 4, value: { payload: `DURING_ANSWER` } },
      {
        kind: `context_inserted`,
        at: 5,
        value: {
          id: `compaction`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `complete`, watermark: 2 },
          content: `SUMMARY_OF_EARLIER_WORK`,
        },
      },
    ])

    const out = serialize(db)
    expect(out).not.toContain(`FIRST_MESSAGE`)
    expect(out).not.toContain(`SECOND_MESSAGE`)
    // Summary first, then the during-compaction prompt + answer verbatim.
    const iSummary = out.indexOf(`SUMMARY_OF_EARLIER_WORK`)
    const iPrompt = out.indexOf(`DURING_PROMPT`)
    const iAnswer = out.indexOf(`DURING_ANSWER`)
    expect(iSummary).toBeGreaterThanOrEqual(0)
    expect(iSummary).toBeLessThan(iPrompt)
    expect(iPrompt).toBeLessThan(iAnswer)
  })

  it(`does NOT hide history for a running (incomplete) checkpoint`, () => {
    // Crash-safety: an in-flight/crashed compaction must never drop history.
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      {
        kind: `context_inserted`,
        at: 2,
        value: {
          id: `compaction`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `running` },
          content: ``,
        },
      },
      { kind: `inbox`, at: 3, value: { payload: `SECOND_MESSAGE` } },
    ])

    const out = serialize(db)
    expect(out).toContain(`FIRST_MESSAGE`)
    expect(out).toContain(`SECOND_MESSAGE`)
    // The running checkpoint is a UI-only marker — not rendered to the model.
    expect(out).not.toContain(`compaction_summary`)
  })

  it(`keeps applying a completed background checkpoint after the NEXT background starts`, () => {
    // Regression: every background generation has a watermark-unique id, so a
    // fresh `running` checkpoint (next generation) must NOT supersede the prior
    // `complete` one. With the old shared id, the running row erased the
    // complete watermark and reconstruction stopped compacting entirely.
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      { kind: `inbox`, at: 2, value: { payload: `SECOND_MESSAGE` } },
      {
        kind: `context_inserted`,
        at: 3,
        value: {
          id: `compaction-bg-2`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `complete`, watermark: 2 },
          content: `SUMMARY_OF_EARLIER_WORK`,
        },
      },
      { kind: `inbox`, at: 4, value: { payload: `LATEST_MESSAGE` } },
      // The next background generation kicks off — different id, so it must not
      // clobber the complete above.
      {
        kind: `context_inserted`,
        at: 5,
        value: {
          id: `compaction-bg-4`,
          name: `compaction_summary`,
          attrs: { kind: `compaction`, status: `running`, watermark: 4 },
          content: ``,
        },
      },
    ])

    const out = serialize(db)
    // The completed checkpoint still compacts away the early messages…
    expect(out).not.toContain(`FIRST_MESSAGE`)
    expect(out).not.toContain(`SECOND_MESSAGE`)
    expect(out).toContain(`SUMMARY_OF_EARLIER_WORK`)
    expect(out).toContain(`LATEST_MESSAGE`)
  })

  it(`is a no-op when there is no compaction checkpoint`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      { kind: `inbox`, at: 2, value: { payload: `SECOND_MESSAGE` } },
    ])

    const out = serialize(db)
    expect(out).toContain(`FIRST_MESSAGE`)
    expect(out).toContain(`SECOND_MESSAGE`)
  })

  it(`ignores a non-compaction context entry (no watermark)`, () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `FIRST_MESSAGE` } },
      {
        kind: `context_inserted`,
        at: 2,
        value: {
          id: `note`,
          name: `note`,
          attrs: {},
          content: `JUST_A_NOTE`,
        },
      },
      { kind: `inbox`, at: 3, value: { payload: `SECOND_MESSAGE` } },
    ])

    const out = serialize(db)
    // A plain context entry must NOT act as a compaction watermark.
    expect(out).toContain(`FIRST_MESSAGE`)
    expect(out).toContain(`SECOND_MESSAGE`)
  })
})
