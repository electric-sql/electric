import { describe, expect, it } from 'vitest'
import { formatEntityConversationView } from '../src/view'
import type { EntityTimelineData } from '@electric-ax/agents-runtime'

function order(index: number): string {
  return index.toString().padStart(20, `0`)
}

describe(`formatEntityConversationView`, () => {
  it(`prints an empty timeline message`, () => {
    expect(
      formatEntityConversationView(
        {
          runs: [],
          inbox: [],
          wakes: [],
          signals: [],
          contextInserted: [],
          contextRemoved: [],
          entities: [],
        },
        { entityUrl: `/chat/test` }
      )
    ).toBe(`No conversation events found`)
  })

  it(`prints user, agent, tool, and wake sections once`, () => {
    const data: EntityTimelineData = {
      runs: [
        {
          key: `run-1`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `text-1`,
              run_id: `run-1`,
              order: order(3),
              status: `completed`,
              text: `Hello\nthere`,
            },
          ],
          toolCalls: [
            {
              key: `tc-1`,
              run_id: `run-1`,
              order: order(4),
              tool_name: `lookup`,
              status: `completed`,
              args: {},
              result: `found`,
            },
          ],
          steps: [],
          errors: [],
        },
      ],
      inbox: [
        {
          key: `msg-1`,
          order: order(1),
          from: `alice`,
          payload: { text: `Hi` },
          timestamp: `2026-03-28T00:00:00.000Z`,
        },
      ],
      wakes: [
        {
          key: `wake-1`,
          order: order(5),
          payload: {
            type: `wake`,
            timestamp: `2026-03-28T00:00:01.000Z`,
            source: `/chat/test`,
            timeout: false,
            changes: [{ collection: `runs`, kind: `update`, key: `run-1` }],
          },
        },
      ],
      signals: [],
      contextInserted: [],
      contextRemoved: [],
      entities: [],
    }

    expect(
      formatEntityConversationView(data, { entityUrl: `/chat/test` })
    ).toBe(
      [
        `alice:`,
        `  Hi`,
        ``,
        `/chat/test:`,
        `  Hello`,
        `  there`,
        `  [tool:lookup] completed`,
        `    found`,
        ``,
        `wake:`,
        `  1 change from /chat/test`,
      ].join(`\n`)
    )
  })
})
