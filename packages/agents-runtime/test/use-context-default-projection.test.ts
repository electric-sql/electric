import { describe, expect, it } from 'vitest'
import { timelineMessages, timelineToMessages } from '../src/timeline-context'
import { buildStreamFixture } from './helpers/context-test-helpers'

describe(`timelineMessages default projection`, () => {
  it(`is byte-identical to timelineToMessages for a no-context stream`, () => {
    const db = buildStreamFixture([
      { kind: `message_received`, at: 1, value: { payload: `hello` } },
      { kind: `wake`, at: 2, value: { payload: `tick` } },
    ])

    const fresh = timelineMessages(db).map(({ at: _at, ...message }) => message)
    const legacy = timelineToMessages(db)
    expect(fresh).toEqual(legacy)
  })

  it(`renders context_inserted as an XML-tag user message`, () => {
    const db = buildStreamFixture([
      {
        kind: `context_inserted`,
        at: 1,
        key: `search:a`,
        value: {
          id: `search:a`,
          name: `search_results`,
          attrs: { query: `x`, hits: 5 },
          content: `body`,
        },
      },
    ])

    const messages = timelineMessages(db)
    expect(messages[0]!.content).toContain(`<search_results`)
    expect(messages[0]!.content).toContain(`query="x"`)
    expect(messages[0]!.content).toContain(`hits="5"`)
    expect(messages[0]!.content).toContain(`>body</search_results>`)
    expect(messages[0]!.at).toBe(1)
  })

  it(`renders a superseded insert as a tombstone self-closing tag`, () => {
    const db = buildStreamFixture([
      {
        kind: `context_inserted`,
        at: 1,
        key: `search:a:v1`,
        value: {
          id: `search:a`,
          name: `search_results`,
          attrs: {},
          content: `old`,
        },
      },
      {
        kind: `context_inserted`,
        at: 2,
        key: `search:a:v2`,
        value: {
          id: `search:a`,
          name: `search_results`,
          attrs: {},
          content: `new`,
        },
      },
    ])

    const messages = timelineMessages(db)
    expect(messages[0]!.content).toContain(
      `superseded_at_offset="0000000000000000_0000000000000001"`
    )
    expect(messages[0]!.content).toContain(
      `load="load_context_history('search:a', '0000000000000000_0000000000000001')"`
    )
    expect(messages[0]!.content).toMatch(/\/>$/)
    expect(messages[1]!.content).toContain(`>new</search_results>`)
  })
})
