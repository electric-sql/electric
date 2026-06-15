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
          attrs: { kind: `compaction` },
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
