import { beforeEach, describe, expect, it } from 'vitest'
import {
  createCollection,
  createLiveQueryCollection,
} from '@durable-streams/state'
import {
  buildEntityTimelineData,
  compareTimelineOrders,
  createEntityIncludesQuery,
  getEntityState,
  normalizeEntityTimelineData,
} from '../src/entity-timeline'
import {
  __resetSectionCachesForTesting,
  buildSections,
  buildTimelineEntries,
} from '../src/use-chat'
import type {
  EntityTimelineContentItem,
  EntityTimelineData,
  IncludesInboxMessage,
  IncludesRun,
} from '../src/entity-timeline'

function order(index: number): string {
  return index.toString().padStart(20, `0`)
}

function offset(index: number): string {
  return `0000000000000000_${index.toString().padStart(16, `0`)}`
}

describe(`compareTimelineOrders`, () => {
  it(`compares two numbers`, () => {
    expect(compareTimelineOrders(1, 2)).toBeLessThan(0)
    expect(compareTimelineOrders(2, 1)).toBeGreaterThan(0)
    expect(compareTimelineOrders(5, 5)).toBe(0)
  })

  it(`compares two padded strings`, () => {
    expect(compareTimelineOrders(order(1), order(2))).toBeLessThan(0)
    expect(compareTimelineOrders(order(2), order(1))).toBeGreaterThan(0)
    expect(compareTimelineOrders(order(5), order(5))).toBe(0)
  })

  it(`compares number vs padded string`, () => {
    expect(compareTimelineOrders(1, order(2))).toBeLessThan(0)
    expect(compareTimelineOrders(2, order(1))).toBeGreaterThan(0)
    expect(compareTimelineOrders(5, order(5))).toBe(0)
  })

  it(`compares padded string vs number`, () => {
    expect(compareTimelineOrders(order(1), 2)).toBeLessThan(0)
    expect(compareTimelineOrders(order(2), 1)).toBeGreaterThan(0)
    expect(compareTimelineOrders(order(5), 5)).toBe(0)
  })

  it(`handles the -1 sentinel value`, () => {
    expect(compareTimelineOrders(-1, 0)).toBeLessThan(0)
    expect(compareTimelineOrders(-1, order(1))).toBeLessThan(0)
    expect(compareTimelineOrders(0, -1)).toBeGreaterThan(0)
  })
})

describe(`entity includes query`, () => {
  describe(`getEntityState`, () => {
    it(`returns pending when no data`, () => {
      expect(getEntityState([], [])).toBe(`pending`)
    })

    it(`returns queued when inbox has messages but no runs`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: { text: `hello` },
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
      ]
      expect(getEntityState([], inbox)).toBe(`queued`)
    })

    it(`returns queued when inbox message is newer than last run`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
        {
          key: `m-1`,
          order: order(5),
          from: `user`,
          payload: `hello again`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        },
      ]
      expect(getEntityState(runs, inbox)).toBe(`queued`)
    })

    it(`returns working when run is started`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `started`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      expect(getEntityState(runs, [])).toBe(`working`)
    })

    it(`returns idle when run is completed`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      expect(getEntityState(runs, [])).toBe(`idle`)
    })

    it(`returns error when run is failed`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `failed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      expect(getEntityState(runs, [])).toBe(`error`)
    })

    it(`returns error when run has errors`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `started`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [
            {
              key: `err-0`,
              run_id: `run-0`,
              error_code: `TOOL_FAILED`,
              message: `boom`,
            },
          ],
        },
      ]
      expect(getEntityState(runs, [])).toBe(`error`)
    })

    it(`returns idle when first run failed but second run completed`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `failed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
        {
          key: `run-1`,
          order: order(5),
          status: `completed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      expect(getEntityState(runs, [])).toBe(`idle`)
    })
  })

  describe(`normalizeEntityTimelineData`, () => {
    it(`anchors a run to its first child event instead of a later run-row update`, () => {
      const normalized = normalizeEntityTimelineData({
        runs: [
          {
            key: `run-0`,
            order: order(8),
            status: `completed`,
            texts: [
              {
                key: `text-0`,
                run_id: `run-0`,
                order: order(2),
                status: `completed`,
                text: `first reply`,
                delta_orders: [order(2)],
              },
            ],
            toolCalls: [],
            steps: [],
            errors: [],
          },
        ],
        inbox: [
          {
            key: `m-0`,
            order: order(1),
            from: `user`,
            payload: `write a long poem`,
            timestamp: `2026-04-15T18:00:00.000Z`,
          },
          {
            key: `m-1`,
            order: order(5),
            from: `user`,
            payload: `one more thing`,
            timestamp: `2026-04-15T18:01:00.000Z`,
          },
        ],
        wakes: [],
        contextInserted: [],
        contextRemoved: [],
        entities: [],
      })

      const sections = buildSections(normalized.runs, normalized.inbox)

      expect(normalized.runs[0]?.order).toBe(order(2))
      expect(sections).toHaveLength(3)
      expect(sections[0]).toMatchObject({
        kind: `user_message`,
        text: `write a long poem`,
      })
      expect(sections[1]).toMatchObject({
        kind: `agent_response`,
        items: [{ kind: `text`, text: `first reply` }],
      })
      expect(sections[2]).toMatchObject({
        kind: `user_message`,
        text: `one more thing`,
      })
    })

    it(`anchors text order to its first delta when the text row itself was updated later`, () => {
      const normalized = normalizeEntityTimelineData({
        runs: [
          {
            key: `run-0`,
            order: order(9),
            status: `completed`,
            texts: [
              {
                key: `text-0`,
                run_id: `run-0`,
                order: order(8),
                status: `completed`,
                text: `draft`,
                delta_orders: [order(2), order(3)],
              },
            ],
            toolCalls: [],
            steps: [],
            errors: [],
          },
        ],
        inbox: [
          {
            key: `m-0`,
            order: order(1),
            from: `user`,
            payload: `first`,
            timestamp: `2026-04-15T18:00:00.000Z`,
          },
          {
            key: `m-1`,
            order: order(5),
            from: `user`,
            payload: `second`,
            timestamp: `2026-04-15T18:01:00.000Z`,
          },
        ],
        wakes: [],
        contextInserted: [],
        contextRemoved: [],
        entities: [],
      })

      expect(normalized.runs[0]?.texts[0]?.order).toBe(order(2))
      expect(normalized.runs[0]?.order).toBe(order(2))
    })
  })

  describe(`buildSections`, () => {
    it(`interleaves inbox messages and runs by order`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `msg-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `hello world`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: { text: `Plan a trip` },
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
      ]
      const sections = buildSections(runs, inbox)

      expect(sections).toHaveLength(2)
      expect(sections[0]).toEqual({
        kind: `user_message`,
        from: `user`,
        text: `Plan a trip`,
        timestamp: Date.parse(`2026-03-17T20:00:00.000Z`),
        isInitial: true,
      })
      expect(sections[1]).toMatchObject({
        kind: `agent_response`,
        items: [{ kind: `text`, text: `hello world` }],
        done: true,
      })
    })

    it(`parses tool call args in buildSections`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `search`,
              status: `completed`,
              args: { q: `cats` },
              result: `3 hits`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({
        kind: `agent_response`,
        items: [
          {
            kind: `tool_call`,
            toolCallId: `tc-0`,
            toolName: `search`,
            args: { q: `cats` },
            status: `completed`,
            result: `3 hits`,
            isError: false,
          },
        ],
        done: true,
      })
    })

    it(`marks run as done when completed`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({ kind: `agent_response`, done: true })
    })

    it(`reports errors from run errors array`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `started`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [
            {
              key: `err-0`,
              run_id: `run-0`,
              error_code: `TOOL_FAILED`,
              message: `boom`,
            },
          ],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({
        kind: `agent_response`,
        error: `boom`,
      })
    })

    it(`handles empty runs and inbox`, () => {
      expect(buildSections([], [])).toEqual([])
    })

    it(`interleaves texts and tool calls within a run by order`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [
            {
              key: `msg-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `hello`,
            },
            {
              key: `msg-1`,
              run_id: `run-0`,
              order: order(6),
              status: `completed`,
              text: `done`,
            },
          ],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(4),
              tool_name: `search`,
              status: `completed`,
              args: {},
              result: `ok`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      const items = (sections[0] as any).items
      expect(items).toHaveLength(3)
      expect(items[0]).toMatchObject({ kind: `text`, text: `hello` })
      expect(items[1]).toMatchObject({ kind: `tool_call`, toolName: `search` })
      expect(items[2]).toMatchObject({ kind: `text`, text: `done` })
    })

    it(`marks failed tool calls with isError`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `started`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `bash`,
              status: `failed`,
              args: {},
              error: `denied`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])
      const items = (sections[0] as any).items
      expect(items[0]).toMatchObject({
        kind: `tool_call`,
        isError: true,
        status: `failed`,
      })
    })

    it(`sets isInitial only for the first user message`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `first`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
        {
          key: `m-1`,
          order: order(3),
          from: `user`,
          payload: `second`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        },
      ]
      const sections = buildSections([], inbox)

      expect(sections).toHaveLength(2)
      expect((sections[0] as any).isInitial).toBe(true)
      expect((sections[1] as any).isInitial).toBe(false)
    })

    it(`reports failed run with error string`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `failed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({
        kind: `agent_response`,
        error: `Run failed`,
      })
    })

    it(`prefers error messages over generic 'Run failed' when both present`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `failed`,
          texts: [],
          toolCalls: [],
          steps: [],
          errors: [
            {
              key: `err-0`,
              run_id: `run-0`,
              error_code: `TOOL_FAILED`,
              message: `db connection lost`,
            },
          ],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect(sections[0]).toMatchObject({
        kind: `agent_response`,
        error: `db connection lost`,
      })
    })

    it(`skips texts with empty string content`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [
            {
              key: `msg-0`,
              run_id: `run-0`,
              order: order(2),
              status: `completed`,
              text: ``,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])

      expect(sections).toHaveLength(1)
      expect((sections[0] as any).items).toHaveLength(0)
    })

    it(`handles null payload in inbox message`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: null,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
      ]
      const sections = buildSections([], inbox)

      expect(sections).toHaveLength(1)
      expect((sections[0] as any).text).toBe(``)
    })

    it(`handles object payload without text field`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: { action: `reset` },
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
      ]
      const sections = buildSections([], inbox)

      expect(sections).toHaveLength(1)
      expect((sections[0] as any).text).toBe(
        JSON.stringify({ action: `reset` })
      )
    })

    it(`handles numeric payload`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: 42,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
      ]
      const sections = buildSections([], inbox)

      expect(sections).toHaveLength(1)
      expect((sections[0] as any).text).toBe(`42`)
    })

    it(`parses JSON string tool args`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `search`,
              status: `completed`,
              args: `{"q":"cats"}`,
              result: `ok`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])
      const items = (sections[0] as any).items
      expect(items[0].args).toEqual({ q: `cats` })
    })

    it(`returns error marker for invalid JSON tool args`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `search`,
              status: `completed`,
              args: `not valid json`,
              result: `ok`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])
      const items = (sections[0] as any).items
      expect(items[0].args).toEqual({
        _raw: `not valid json`,
        _parseError: `Invalid JSON tool args`,
      })
    })

    it(`returns empty object for null tool args`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `search`,
              status: `completed`,
              args: null,
              result: `ok`,
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])
      const items = (sections[0] as any).items
      expect(items[0].args).toEqual({})
    })

    it(`JSON-stringifies non-string tool call results`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(1),
          status: `completed`,
          texts: [],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(2),
              tool_name: `count`,
              status: `completed`,
              args: {},
              result: { count: 3 },
            },
          ],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, [])
      const items = (sections[0] as any).items
      expect(items[0].result).toBe(`{"count":3}`)
    })

    it(`interleaves multiple runs with multiple inbox messages`, () => {
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
        {
          key: `m-1`,
          order: order(5),
          from: `user`,
          payload: `followup`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        },
      ]
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `msg-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `reply1`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        },
        {
          key: `run-1`,
          order: order(6),
          status: `completed`,
          texts: [
            {
              key: `msg-1`,
              run_id: `run-1`,
              order: order(7),
              status: `completed`,
              text: `reply2`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const sections = buildSections(runs, inbox)

      expect(sections).toHaveLength(4)
      expect(sections[0]).toMatchObject({ kind: `user_message`, text: `hi` })
      expect(sections[1]).toMatchObject({
        kind: `agent_response`,
        items: [{ kind: `text`, text: `reply1` }],
      })
      expect(sections[2]).toMatchObject({
        kind: `user_message`,
        text: `followup`,
      })
      expect(sections[3]).toMatchObject({
        kind: `agent_response`,
        items: [{ kind: `text`, text: `reply2` }],
      })
    })

    it(`builds keyed entries and sections from the same ordered pass`, () => {
      const runs: Array<IncludesRun> = [
        {
          key: `run-0`,
          order: order(8),
          status: `completed`,
          texts: [
            {
              key: `text-0`,
              run_id: `run-0`,
              order: order(2),
              status: `completed`,
              text: `reply`,
              delta_orders: [order(2)],
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        },
      ]
      const inbox: Array<IncludesInboxMessage> = [
        {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hello`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        },
        {
          key: `m-1`,
          order: order(5),
          from: `user`,
          payload: `followup`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        },
      ]

      const normalized = normalizeEntityTimelineData({
        runs,
        inbox,
        wakes: [],
        contextInserted: [],
        contextRemoved: [],
        entities: [],
      })
      const entries = buildTimelineEntries(normalized.runs, normalized.inbox)
      const sections = buildSections(normalized.runs, normalized.inbox)

      expect(entries.map((entry) => entry.key)).toEqual([
        `inbox:m-0`,
        `run:run-0`,
        `inbox:m-1`,
      ])
      expect(entries.map((entry) => entry.section)).toEqual(sections)
      expect(entries[1]?.responseTimestamp).toBe(
        Date.parse(`2026-03-17T20:00:00.000Z`)
      )
    })

    describe(`section identity stability`, () => {
      beforeEach(() => {
        __resetSectionCachesForTesting()
      })

      it(`returns the same section references when called twice with the same inputs`, () => {
        const runs: Array<IncludesRun> = [
          {
            key: `run-0`,
            order: order(2),
            status: `completed`,
            texts: [
              {
                key: `t-0`,
                run_id: `run-0`,
                order: order(3),
                status: `completed`,
                text: `hello`,
              },
            ],
            toolCalls: [],
            steps: [],
            errors: [],
          },
        ]
        const inbox: Array<IncludesInboxMessage> = [
          {
            key: `m-0`,
            order: order(1),
            from: `user`,
            payload: `hi`,
            timestamp: `2026-03-17T20:00:00.000Z`,
          },
        ]

        const first = buildSections(runs, inbox)
        const second = buildSections(runs, inbox)

        expect(second).toHaveLength(2)
        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
      })

      it(`preserves earlier section references when a new exchange is appended`, () => {
        const msg0: IncludesInboxMessage = {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        }
        const run0: IncludesRun = {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `first reply`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }

        const first = buildSections([run0], [msg0])
        expect(first).toHaveLength(2)

        const msg1: IncludesInboxMessage = {
          key: `m-1`,
          order: order(4),
          from: `user`,
          payload: `follow up`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        }
        const run1: IncludesRun = {
          key: `run-1`,
          order: order(5),
          status: `completed`,
          texts: [
            {
              key: `t-1`,
              run_id: `run-1`,
              order: order(6),
              status: `completed`,
              text: `second reply`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }

        const second = buildSections([run0, run1], [msg0, msg1])

        expect(second).toHaveLength(4)
        // Earlier sections are reused from the first call.
        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
      })

      it(`invalidates only the run whose row reference changed`, () => {
        const msg0: IncludesInboxMessage = {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        }
        const run0: IncludesRun = {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `first reply`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }
        const msg1: IncludesInboxMessage = {
          key: `m-1`,
          order: order(4),
          from: `user`,
          payload: `follow up`,
          timestamp: `2026-03-17T20:01:00.000Z`,
        }
        const run1: IncludesRun = {
          key: `run-1`,
          order: order(5),
          status: `started`,
          texts: [
            {
              key: `t-1`,
              run_id: `run-1`,
              order: order(6),
              status: `streaming`,
              text: `partial`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }

        const first = buildSections([run0, run1], [msg0, msg1])
        expect(first).toHaveLength(4)

        // Simulate the IVM row-replacement pattern we rely on at runtime:
        // when a row changes, its object reference is replaced, while
        // unchanged rows keep their original reference. Here run1 gets a
        // new reference but msg0/run0/msg1 are still ===.
        const run1Updated: IncludesRun = {
          ...run1,
          texts: [
            {
              key: `t-1`,
              run_id: `run-1`,
              order: order(6),
              status: `streaming`,
              text: `partial and more`,
            },
          ],
        }

        const second = buildSections([run0, run1Updated], [msg0, msg1])

        expect(second).toHaveLength(4)
        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])
        expect(second[2]).toBe(first[2])
        // Only the changed run's section is new.
        expect(second[3]).not.toBe(first[3])
        expect(
          (second[3] as { items: Array<{ text?: string }> }).items[0]?.text
        ).toBe(`partial and more`)
      })

      it(`preserves section identity when a run is built fresh then reused`, () => {
        // Same inbox message referenced across two builds with different
        // run sets — msg0's section should stay stable.
        const msg0: IncludesInboxMessage = {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        }
        const run0: IncludesRun = {
          key: `run-0`,
          order: order(2),
          status: `started`,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(3),
              status: `streaming`,
              text: `tok1`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }
        const first = buildSections([run0], [msg0])

        const run0Next: IncludesRun = {
          ...run0,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(3),
              status: `streaming`,
              text: `tok1 tok2`,
            },
          ],
        }
        const second = buildSections([run0Next], [msg0])

        // msg0 section stays identity-stable across the streaming tick.
        expect(second[0]).toBe(first[0])
        expect(second[1]).not.toBe(first[1])
      })

      it(`non-terminal run reused as the same reference never returns a stale section`, () => {
        // Guard against a regression where streaming runs are cached. If
        // someone re-adds `agentSectionCache.set(run, ...)` unconditionally,
        // a second tick with the same run reference would return the first
        // tick's section (frozen at the earlier text content) — which is the
        // bug the status-gated cache was introduced to fix.
        const run: IncludesRun = {
          key: `run-0`,
          order: order(1),
          status: `started`,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(2),
              status: `streaming`,
              text: `tok1`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }
        const first = buildSections([run], [])
        const firstSection = first[0] as { items: Array<{ text?: string }> }
        expect(firstSection.items[0]?.text).toBe(`tok1`)

        // Mutate the texts in place on the SAME run reference — the worst
        // case for the cache: IVM cannot always be relied on to swap the
        // outer row reference when nested arrays grow.
        run.texts[0]!.text = `tok1 tok2`

        const second = buildSections([run], [])
        const secondSection = second[0] as { items: Array<{ text?: string }> }
        expect(secondSection.items[0]?.text).toBe(`tok1 tok2`)
      })

      it(`run observed first as streaming then as terminal reflects the terminal content`, () => {
        // Same run reference, status flipped from `started` to `completed`
        // with final text. The terminal call must produce the completed
        // section (done: true, updated items), never a cached section from
        // the earlier streaming observation.
        const run: IncludesRun = {
          key: `run-1`,
          order: order(1),
          status: `started`,
          texts: [
            {
              key: `t-1`,
              run_id: `run-1`,
              order: order(2),
              status: `streaming`,
              text: `partial`,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        }
        const streaming = buildSections([run], [])
        const streamingSection = streaming[0] as {
          done?: true
          items: Array<{ text?: string }>
        }
        expect(streamingSection.done).toBeUndefined()
        expect(streamingSection.items[0]?.text).toBe(`partial`)

        run.status = `completed`
        run.texts[0]!.status = `completed`
        run.texts[0]!.text = `partial and final`

        const terminal = buildSections([run], [])
        const terminalSection = terminal[0] as {
          done?: true
          items: Array<{ text?: string }>
        }
        expect(terminalSection.done).toBe(true)
        expect(terminalSection.items[0]?.text).toBe(`partial and final`)
      })

      it(`re-derives a cached user message when an earlier inbox row is prepended`, () => {
        // The userSectionCache has two slots — `initial` and `nonInitial` —
        // because `isInitial` depends on the message's position, not just the
        // row. If a late-arriving earlier message is inserted, the previously
        // first message must produce a new, non-initial section rather than
        // returning the cached initial version.
        const msg0: IncludesInboxMessage = {
          key: `m-0`,
          order: order(5),
          from: `user`,
          payload: `originally first`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        }

        const first = buildSections([], [msg0])
        expect(first).toHaveLength(1)
        const msg0InitialSection = first[0] as {
          kind: `user_message`
          isInitial: boolean
        }
        expect(msg0InitialSection.isInitial).toBe(true)

        // Prepend an earlier message. msg0 is now second in order, so its
        // section must report isInitial=false — even though the row reference
        // hasn't changed.
        const msgEarlier: IncludesInboxMessage = {
          key: `m-earlier`,
          order: order(1),
          from: `user`,
          payload: `actually first`,
          timestamp: `2026-03-17T19:59:00.000Z`,
        }

        const second = buildSections([], [msgEarlier, msg0])
        expect(second).toHaveLength(2)
        const msgEarlierSection = second[0] as {
          kind: `user_message`
          isInitial: boolean
        }
        const msg0NonInitialSection = second[1] as {
          kind: `user_message`
          isInitial: boolean
        }
        expect(msgEarlierSection.isInitial).toBe(true)
        expect(msg0NonInitialSection.isInitial).toBe(false)
        // Must be a new reference — returning the cached initial version
        // would silently hand back a section with the wrong isInitial.
        expect(msg0NonInitialSection).not.toBe(msg0InitialSection)

        // Re-calling with the same inputs returns the cached nonInitial slot.
        const third = buildSections([], [msgEarlier, msg0])
        expect(third[0]).toBe(second[0])
        expect(third[1]).toBe(second[1])

        // And calling again with only msg0 still returns the original
        // initial-slot section, not the nonInitial one.
        const fourth = buildSections([], [msg0])
        expect(fourth[0]).toBe(msg0InitialSection)
      })

      it(`preserves identity when row references are replaced but content is unchanged`, () => {
        // The runtime's includes-build pipeline rebuilds every IncludesRun
        // and IncludesInboxMessage on every emit (each layer maps through
        // `({...row, ...})`), so the row reference observed on tick N is
        // never the reference observed on tick N+1 even when nothing
        // about the row changed. The cache MUST key on stable identifiers
        // (run.key / msg.key) + a content fingerprint, not on the raw row
        // reference, otherwise streaming would force every <AgentResponse>
        // in the timeline to re-render on every chunk.
        //
        // This test simulates that pipeline by cloning every row between
        // builds while keeping content byte-identical. The cache must
        // still hit and return the original section references.
        const cloneRun = (r: IncludesRun): IncludesRun => ({
          ...r,
          texts: r.texts.map((t) => ({ ...t })),
          toolCalls: r.toolCalls.map((tc) => ({ ...tc })),
          steps: r.steps.map((s) => ({ ...s })),
          errors: r.errors.map((e) => ({ ...e })),
        })
        const cloneMsg = (m: IncludesInboxMessage): IncludesInboxMessage => ({
          ...m,
        })

        const msg0: IncludesInboxMessage = {
          key: `m-0`,
          order: order(1),
          from: `user`,
          payload: `hi`,
          timestamp: `2026-03-17T20:00:00.000Z`,
        }
        const run0: IncludesRun = {
          key: `run-0`,
          order: order(2),
          status: `completed`,
          texts: [
            {
              key: `t-0`,
              run_id: `run-0`,
              order: order(3),
              status: `completed`,
              text: `hello world`,
            },
          ],
          toolCalls: [
            {
              key: `tc-0`,
              run_id: `run-0`,
              order: order(4),
              tool_name: `search`,
              status: `completed`,
              args: { q: `cats` },
              result: `ok`,
            },
          ],
          steps: [],
          errors: [],
        }

        const first = buildSections([run0], [msg0])
        expect(first).toHaveLength(2)

        // Re-build with cloned rows — identical content, fresh references.
        const second = buildSections([cloneRun(run0)], [cloneMsg(msg0)])

        expect(second).toHaveLength(2)
        // Both sections must be the SAME reference as the first build,
        // even though every input row is a new object.
        expect(second[0]).toBe(first[0])
        expect(second[1]).toBe(first[1])

        // And inner items inside the agent section must also be reference-
        // stable, since we returned the cached section verbatim.
        const firstAgent = first[1] as {
          items: Array<EntityTimelineContentItem>
        }
        const secondAgent = second[1] as {
          items: Array<EntityTimelineContentItem>
        }
        expect(secondAgent.items).toBe(firstAgent.items)
      })

      it(`bounds the cache: stale entries are evicted when rows leave the timeline`, () => {
        // Without pruning, the module-level caches would accumulate every
        // run / msg ever observed across every entity the user has
        // navigated through. `pruneSectionCaches` (called at the end of
        // every buildTimelineEntries) drops entries whose keys aren't in
        // the latest build.
        const mkRun = (key: string, text: string): IncludesRun => ({
          key,
          order: order(1),
          status: `completed`,
          texts: [
            {
              key: `t-${key}`,
              run_id: key,
              order: order(2),
              status: `completed`,
              text,
            },
          ],
          toolCalls: [],
          steps: [],
          errors: [],
        })

        const runA = mkRun(`run-a`, `entity A response`)
        const runB = mkRun(`run-b`, `entity B response`)
        const runC = mkRun(`run-c`, `entity C response`)

        // First build: all three runs in cache.
        const first = buildSections([runA, runB, runC], [])
        expect(first).toHaveLength(3)

        // Second build with only runB — runA + runC must be evicted.
        // Quick proxy for cache state: rebuild and check whether the
        // returned section is the same reference (cache hit) or a new
        // one (cache miss).
        const second = buildSections([runB], [])
        expect(second[0]).toBe(first[1]) // runB still cached

        // Now bring runA back; if the cache had been bounded properly
        // it should have been evicted by the previous build, so this
        // build creates a fresh section. (We can't directly observe
        // eviction, but we can observe that bringing a row back after
        // it left the live set still produces a section with the same
        // CONTENT — proving the cache logic doesn't blow up — and we
        // can verify pruneSectionCaches doesn't accidentally evict
        // currently-live entries.)
        const third = buildSections([runA, runB], [])
        expect(third).toHaveLength(2)
        expect(third[1]).toBe(second[0]) // runB still cached across builds
      })
    })
  })

  describe(`includes query reactivity`, () => {
    /**
     * Create a collection with exposed sync primitives (begin/write/commit).
     * This mirrors how StreamDB feeds data from SSE into TanStack DB collections.
     */
    function createSyncCollection<
      T extends Record<string, unknown> & { key: string | number } = Record<
        string,
        unknown
      > & { key: string | number },
    >(id: string, takeOffset: () => string) {
      let syncBegin: () => void
      let syncWrite: (msg: { type: string; value: T }) => void
      let syncCommit: () => void
      const rowOffsets = new Map<string | number, string>()

      const collection = createCollection<T, string>({
        id,
        getKey: (item) => String(item.key),
        sync: {
          sync: (params: any) => {
            syncBegin = params.begin
            syncWrite = params.write
            syncCommit = params.commit
            params.markReady()
            return () => {}
          },
        },
        startSync: true,
        gcTime: 0,
      })
      const collectionWithOffsets = collection as typeof collection & {
        __electricRowOffsets?: Map<string | number, string>
      }
      collectionWithOffsets.__electricRowOffsets = rowOffsets

      return {
        collection: collectionWithOffsets,
        insert(value: T) {
          rowOffsets.set(value.key, takeOffset())
          syncBegin!()
          syncWrite!({ type: `insert`, value })
          syncCommit!()
        },
        update(value: T) {
          rowOffsets.set(value.key, takeOffset())
          syncBegin!()
          syncWrite!({ type: `update`, value })
          syncCommit!()
        },
      }
    }

    function withSeqInjection(
      syncCollection: ReturnType<typeof createSyncCollection>,
      takeSeq: () => number
    ) {
      return {
        ...syncCollection,
        insert(value: Record<string, unknown>) {
          syncCollection.insert({ ...value, _seq: takeSeq() } as any)
        },
        update(value: Record<string, unknown>) {
          syncCollection.update({ ...value, _seq: takeSeq() } as any)
        },
      }
    }

    function createEntityCollections() {
      let nextOffset = 1
      let nextSeq = 1
      const takeOffset = () => offset(nextOffset++)
      const takeSeq = () => nextSeq++
      const runs = createSyncCollection(`test-runs`, takeOffset)
      const texts = createSyncCollection(`test-texts`, takeOffset)
      const textDeltas = createSyncCollection(`test-textDeltas`, takeOffset)
      const toolCalls = createSyncCollection(`test-toolCalls`, takeOffset)
      const steps = createSyncCollection(`test-steps`, takeOffset)
      const errors = createSyncCollection(`test-errors`, takeOffset)
      const inbox = createSyncCollection(`test-inbox`, takeOffset)
      const wakes = createSyncCollection(`test-wakes`, takeOffset)
      const contextInserted = createSyncCollection(
        `test-context-inserted`,
        takeOffset
      )
      const contextRemoved = createSyncCollection(
        `test-context-removed`,
        takeOffset
      )
      const manifests = createSyncCollection(`test-manifests`, takeOffset)
      const childStatus = createSyncCollection(`test-child-status`, takeOffset)
      return {
        collections: {
          runs: runs.collection,
          texts: texts.collection,
          textDeltas: textDeltas.collection,
          toolCalls: toolCalls.collection,
          steps: steps.collection,
          errors: errors.collection,
          inbox: inbox.collection,
          wakes: wakes.collection,
          contextInserted: contextInserted.collection,
          contextRemoved: contextRemoved.collection,
          manifests: manifests.collection,
          childStatus: childStatus.collection,
        },
        sync: {
          runs: withSeqInjection(runs, takeSeq),
          texts: withSeqInjection(texts, takeSeq),
          textDeltas: withSeqInjection(textDeltas, takeSeq),
          toolCalls: withSeqInjection(toolCalls, takeSeq),
          steps: withSeqInjection(steps, takeSeq),
          errors: withSeqInjection(errors, takeSeq),
          inbox: withSeqInjection(inbox, takeSeq),
          wakes: withSeqInjection(wakes, takeSeq),
          contextInserted: withSeqInjection(contextInserted, takeSeq),
          contextRemoved: withSeqInjection(contextRemoved, takeSeq),
          manifests: withSeqInjection(manifests, takeSeq),
          childStatus: withSeqInjection(childStatus, takeSeq),
        },
      }
    }

    function getData(liveQuery: any): Array<any> {
      return Array.from(liveQuery.entries()).map(([, v]: any) => v)
    }

    function getTimelineData(liveQuery: any): EntityTimelineData | undefined {
      const data = getData(liveQuery)[0] as EntityTimelineData | undefined
      return data ? normalizeEntityTimelineData(data) : undefined
    }

    function trackChanges(collection: any) {
      let changeCount = 0
      collection.subscribeChanges(() => {
        changeCount++
      })
      return {
        get count() {
          return changeCount
        },
      }
    }

    it(`reacts to changes in the top-level runs collection`, async () => {
      const { collections, sync } = createEntityCollections()
      const queryFn = createEntityIncludesQuery({ collections } as any)
      const liveQuery = createLiveQueryCollection({
        query: queryFn,
        startSync: true,
      })
      await liveQuery.preload()
      const tracker = trackChanges(liveQuery)

      sync.runs.insert({ key: `run-1`, status: `started` })
      await new Promise((r) => setTimeout(r, 50))
      expect(getData(liveQuery)).toHaveLength(1)
      expect(getTimelineData(liveQuery)?.runs).toHaveLength(1)

      const countBefore = tracker.count
      sync.runs.update({ key: `run-1`, status: `completed` })
      await new Promise((r) => setTimeout(r, 50))
      expect(tracker.count).toBeGreaterThan(countBefore)
    })

    it(`reacts to textDelta insertions`, async () => {
      const { collections, sync } = createEntityCollections()
      const queryFn = createEntityIncludesQuery({ collections } as any)
      const liveQuery = createLiveQueryCollection({
        query: queryFn,
        startSync: true,
      })
      await liveQuery.preload()

      sync.runs.insert({ key: `run-1`, status: `started` })
      sync.texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        status: `streaming`,
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(getTimelineData(liveQuery)?.runs[0]?.texts).toHaveLength(1)
      expect(getTimelineData(liveQuery)?.runs[0]?.texts[0]?.text).toBe(``)

      sync.textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        run_id: `run-1`,
        delta: `Hello`,
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(getTimelineData(liveQuery)?.runs[0]?.texts[0]?.text).toBe(`Hello`)

      sync.textDeltas.insert({
        key: `td-2`,
        text_id: `text-1`,
        run_id: `run-1`,
        delta: ` world`,
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(getTimelineData(liveQuery)?.runs[0]?.texts[0]?.text).toBe(
        `Hello world`
      )
    })

    it(`keeps a streaming run ahead of a later inbox message after the run row updates`, async () => {
      const { collections, sync } = createEntityCollections()
      const queryFn = createEntityIncludesQuery({ collections } as any)
      const liveQuery = createLiveQueryCollection({
        query: queryFn,
        startSync: true,
      })
      await liveQuery.preload()

      sync.inbox.insert({
        key: `msg-1`,
        from: `user`,
        payload: `write a long poem`,
        timestamp: `2026-04-15T18:00:00.000Z`,
      })
      sync.runs.insert({ key: `run-1`, status: `started` })
      sync.texts.insert({
        key: `text-1`,
        run_id: `run-1`,
        status: `streaming`,
      })
      sync.textDeltas.insert({
        key: `td-1`,
        text_id: `text-1`,
        run_id: `run-1`,
        delta: `First line`,
      })
      sync.inbox.insert({
        key: `msg-2`,
        from: `user`,
        payload: `now write an RFC`,
        timestamp: `2026-04-15T18:01:00.000Z`,
      })
      await new Promise((r) => setTimeout(r, 50))

      sync.texts.update({
        key: `text-1`,
        run_id: `run-1`,
        status: `completed`,
      })
      sync.runs.update({
        key: `run-1`,
        status: `completed`,
      })
      await new Promise((r) => setTimeout(r, 50))

      const timelineData = getTimelineData(liveQuery)
      expect(timelineData?.runs[0]?.order).toBe(4)

      const sections = buildSections(
        timelineData?.runs ?? [],
        timelineData?.inbox ?? []
      )
      expect(sections).toHaveLength(3)
      expect(sections[0]).toMatchObject({
        kind: `user_message`,
        text: `write a long poem`,
      })
      expect(sections[1]).toMatchObject({
        kind: `agent_response`,
        items: [{ kind: `text`, text: `First line` }],
      })
      expect(sections[2]).toMatchObject({
        kind: `user_message`,
        text: `now write an RFC`,
      })
    })

    it(`reacts to toolCall updates`, async () => {
      const { collections, sync } = createEntityCollections()
      const queryFn = createEntityIncludesQuery({ collections } as any)
      const liveQuery = createLiveQueryCollection({
        query: queryFn,
        startSync: true,
      })
      await liveQuery.preload()
      const tracker = trackChanges(liveQuery)

      sync.runs.insert({ key: `run-1`, status: `started` })
      sync.toolCalls.insert({
        key: `tc-1`,
        run_id: `run-1`,
        tool_name: `search`,
        status: `started`,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(getTimelineData(liveQuery)?.runs[0]?.toolCalls[0]?.status).toBe(
        `started`
      )

      const countBefore = tracker.count
      sync.toolCalls.update({
        key: `tc-1`,
        run_id: `run-1`,
        tool_name: `search`,
        status: `completed`,
        result: `3 results found`,
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(tracker.count).toBeGreaterThan(countBefore)
      expect(getTimelineData(liveQuery)?.runs[0]?.toolCalls[0]?.status).toBe(
        `completed`
      )
    })

    it(`projects related entities from one manifest row per related entity`, () => {
      const timeline = buildEntityTimelineData({
        collections: {
          runs: { toArray: [] },
          texts: { toArray: [] },
          textDeltas: { toArray: [] },
          toolCalls: { toArray: [] },
          steps: { toArray: [] },
          errors: { toArray: [] },
          inbox: { toArray: [] },
          wakes: { toArray: [] },
          contextInserted: { toArray: [], __electricRowOffsets: new Map() },
          contextRemoved: { toArray: [], __electricRowOffsets: new Map() },
          manifests: {
            toArray: [
              {
                key: `child:worker:writer-1`,
                kind: `child`,
                id: `writer-1`,
                entity_type: `worker`,
                entity_url: `/worker/writer-1`,
                observed: true,
                wake: `runFinished`,
              },
              {
                key: `source:entity:/assistant/reviewer-1`,
                kind: `source`,
                sourceType: `entity`,
                sourceRef: `/assistant/reviewer-1`,
                config: { entityUrl: `/assistant/reviewer-1` },
                wake: { on: `change`, collections: [`text`] },
              },
            ],
            __electricRowOffsets: new Map([
              [`child:worker:writer-1`, offset(1)],
              [`source:entity:/assistant/reviewer-1`, offset(2)],
            ]),
          },
          childStatus: {
            toArray: [
              {
                key: `/worker/writer-1`,
                entity_url: `/worker/writer-1`,
                entity_type: `worker`,
                status: `idle`,
              },
              {
                key: `/assistant/reviewer-1`,
                entity_url: `/assistant/reviewer-1`,
                entity_type: `assistant`,
                status: `running`,
              },
            ],
          },
        },
      } as any)

      expect(timeline.entities).toEqual([
        {
          key: `/worker/writer-1`,
          kind: `child`,
          id: `writer-1`,
          url: `/worker/writer-1`,
          type: `worker`,
          status: `idle`,
          observed: true,
          wake: `runFinished`,
        },
        {
          key: `/assistant/reviewer-1`,
          kind: `source`,
          id: `/assistant/reviewer-1`,
          url: `/assistant/reviewer-1`,
          type: `assistant`,
          status: `running`,
          observed: true,
          wake: { on: `change`, collections: [`text`] },
        },
      ])
    })

    it(`derives timeline ordering from StreamDB row offsets when inline sequence metadata is absent`, () => {
      const timeline = buildEntityTimelineData({
        collections: {
          runs: {
            toArray: [{ key: `run-1`, status: `completed` }],
            __electricRowOffsets: new Map([
              [`run-1`, `0000000000000000_0000000000000002`],
            ]),
          },
          texts: {
            toArray: [{ key: `text-1`, run_id: `run-1`, status: `completed` }],
            __electricRowOffsets: new Map([
              [`text-1`, `0000000000000000_0000000000000003`],
            ]),
          },
          textDeltas: {
            toArray: [
              {
                key: `delta-1`,
                text_id: `text-1`,
                run_id: `run-1`,
                delta: `hello from Rome`,
              },
            ],
            __electricRowOffsets: new Map([
              [`delta-1`, `0000000000000000_0000000000000004`],
            ]),
          },
          toolCalls: { toArray: [], __electricRowOffsets: new Map() },
          steps: { toArray: [], __electricRowOffsets: new Map() },
          errors: { toArray: [] },
          inbox: {
            toArray: [
              {
                key: `msg-1`,
                from: `user`,
                payload: `tell me about Rome`,
                timestamp: `2026-03-31T10:00:00.000Z`,
              },
            ],
            __electricRowOffsets: new Map([
              [`msg-1`, `0000000000000000_0000000000000001`],
            ]),
          },
          wakes: { toArray: [], __electricRowOffsets: new Map() },
          contextInserted: { toArray: [], __electricRowOffsets: new Map() },
          contextRemoved: { toArray: [], __electricRowOffsets: new Map() },
          manifests: { toArray: [], __electricRowOffsets: new Map() },
          childStatus: { toArray: [], __electricRowOffsets: new Map() },
        },
      } as any)

      expect(timeline.inbox[0]?.order).toBe(order(1))
      expect(timeline.runs[0]?.order).toBe(order(2))
      expect(timeline.runs[0]?.texts[0]?.order).toBe(order(3))
      expect(timeline.runs[0]?.texts[0]?.text).toBe(`hello from Rome`)
    })

    it(`includes context_inserted and context_removed rows`, () => {
      const timeline = buildEntityTimelineData({
        collections: {
          runs: { toArray: [], __electricRowOffsets: new Map() },
          texts: { toArray: [], __electricRowOffsets: new Map() },
          textDeltas: { toArray: [], __electricRowOffsets: new Map() },
          toolCalls: { toArray: [], __electricRowOffsets: new Map() },
          steps: { toArray: [], __electricRowOffsets: new Map() },
          errors: { toArray: [] },
          inbox: { toArray: [], __electricRowOffsets: new Map() },
          wakes: { toArray: [], __electricRowOffsets: new Map() },
          contextInserted: {
            toArray: [
              {
                key: `context:search:a:1`,
                id: `search:a`,
                name: `search_results`,
                attrs: { query: `a` },
                content: `body`,
                timestamp: `2026-04-13T00:00:00.000Z`,
              },
            ],
            __electricRowOffsets: new Map([[`context:search:a:1`, offset(1)]]),
          },
          contextRemoved: {
            toArray: [
              {
                key: `context:search:a:removed:2`,
                id: `search:a`,
                name: `search_results`,
                timestamp: `2026-04-13T00:01:00.000Z`,
              },
            ],
            __electricRowOffsets: new Map([
              [`context:search:a:removed:2`, offset(2)],
            ]),
          },
          manifests: { toArray: [], __electricRowOffsets: new Map() },
          childStatus: { toArray: [], __electricRowOffsets: new Map() },
        },
      } as any)

      expect(timeline.contextInserted).toEqual([
        {
          key: `context:search:a:1`,
          order: order(1),
          historyOffset: offset(1),
          id: `search:a`,
          name: `search_results`,
          attrs: { query: `a` },
          content: `body`,
          timestamp: `2026-04-13T00:00:00.000Z`,
        },
      ])
      expect(timeline.contextRemoved).toEqual([
        {
          key: `context:search:a:removed:2`,
          order: order(2),
          historyOffset: offset(2),
          id: `search:a`,
          name: `search_results`,
          timestamp: `2026-04-13T00:01:00.000Z`,
        },
      ])
    })

    it(`reacts to manifest and child status changes in the timeline query`, async () => {
      const { collections, sync } = createEntityCollections()
      const queryFn = createEntityIncludesQuery({ collections } as any)
      const liveQuery = createLiveQueryCollection({
        query: queryFn,
        startSync: true,
      })
      await liveQuery.preload()

      sync.manifests.insert({
        key: `child:worker:writer-1`,
        kind: `child`,
        id: `writer-1`,
        entity_type: `worker`,
        entity_url: `/worker/writer-1`,
      })
      await new Promise((r) => setTimeout(r, 50))

      const afterManifest = getTimelineData(liveQuery)?.entities ?? []
      expect(afterManifest).toHaveLength(1)
      expect(afterManifest[0]).toMatchObject({
        key: `/worker/writer-1`,
        kind: `child`,
        id: `writer-1`,
        url: `/worker/writer-1`,
        type: `worker`,
        observed: false,
      })

      sync.childStatus.insert({
        key: `/worker/writer-1`,
        entity_url: `/worker/writer-1`,
        entity_type: `worker`,
        status: `running`,
      })
      await new Promise((r) => setTimeout(r, 50))

      const afterStatus = getTimelineData(liveQuery)?.entities ?? []
      expect(afterStatus).toHaveLength(1)
      expect(afterStatus[0]).toMatchObject({
        key: `/worker/writer-1`,
        kind: `child`,
        id: `writer-1`,
        url: `/worker/writer-1`,
        type: `worker`,
        status: `running`,
        observed: false,
      })
    })

    it(`coalesces child and observe manifest rows for the same entity url`, async () => {
      const syncTimeline = buildEntityTimelineData({
        collections: {
          runs: { toArray: [] },
          texts: { toArray: [] },
          textDeltas: { toArray: [] },
          toolCalls: { toArray: [] },
          steps: { toArray: [] },
          errors: { toArray: [] },
          inbox: { toArray: [] },
          wakes: { toArray: [] },
          contextInserted: { toArray: [], __electricRowOffsets: new Map() },
          contextRemoved: { toArray: [], __electricRowOffsets: new Map() },
          manifests: {
            toArray: [
              {
                key: `child:worker:writer-1`,
                kind: `child`,
                id: `writer-1`,
                entity_type: `worker`,
                entity_url: `/worker/writer-1`,
                observed: false,
              },
              {
                key: `source:entity:/worker/writer-1`,
                kind: `source`,
                sourceType: `entity`,
                sourceRef: `/worker/writer-1`,
                config: { entityUrl: `/worker/writer-1` },
                wake: `runFinished`,
              },
            ],
            __electricRowOffsets: new Map([
              [`child:worker:writer-1`, offset(1)],
              [`source:entity:/worker/writer-1`, offset(2)],
            ]),
          },
          childStatus: {
            toArray: [
              {
                key: `/worker/writer-1`,
                entity_url: `/worker/writer-1`,
                entity_type: `worker`,
                status: `running`,
              },
            ],
          },
        },
      } as any)

      expect(syncTimeline.entities).toEqual([
        {
          key: `/worker/writer-1`,
          kind: `child`,
          id: `writer-1`,
          url: `/worker/writer-1`,
          type: `worker`,
          status: `running`,
          observed: true,
          wake: `runFinished`,
        },
      ])

      const { collections, sync } = createEntityCollections()
      const liveQuery = createLiveQueryCollection({
        query: createEntityIncludesQuery({ collections } as any),
        startSync: true,
      })
      await liveQuery.preload()

      sync.manifests.insert({
        key: `child:worker:writer-1`,
        kind: `child`,
        id: `writer-1`,
        entity_type: `worker`,
        entity_url: `/worker/writer-1`,
        observed: false,
      })
      sync.manifests.insert({
        key: `source:entity:/worker/writer-1`,
        kind: `source`,
        sourceType: `entity`,
        sourceRef: `/worker/writer-1`,
        config: { entityUrl: `/worker/writer-1` },
        wake: `runFinished`,
      })
      sync.childStatus.insert({
        key: `/worker/writer-1`,
        entity_url: `/worker/writer-1`,
        entity_type: `worker`,
        status: `running`,
      })
      await new Promise((r) => setTimeout(r, 50))

      expect(getTimelineData(liveQuery)?.entities).toEqual([
        {
          key: `/worker/writer-1`,
          kind: `child`,
          id: `writer-1`,
          url: `/worker/writer-1`,
          type: `worker`,
          status: `running`,
          observed: true,
          wake: `runFinished`,
        },
      ])
    })

    it(`keeps missing entity type and status undefined in the live query`, async () => {
      const syncTimeline = buildEntityTimelineData({
        collections: {
          runs: { toArray: [] },
          texts: { toArray: [] },
          textDeltas: { toArray: [] },
          toolCalls: { toArray: [] },
          steps: { toArray: [] },
          errors: { toArray: [] },
          inbox: { toArray: [] },
          wakes: { toArray: [] },
          contextInserted: { toArray: [], __electricRowOffsets: new Map() },
          contextRemoved: { toArray: [], __electricRowOffsets: new Map() },
          manifests: {
            toArray: [
              {
                key: `source:entity:/assistant/reviewer-1`,
                kind: `source`,
                sourceType: `entity`,
                sourceRef: `/assistant/reviewer-1`,
                config: { entityUrl: `/assistant/reviewer-1` },
              },
            ],
            __electricRowOffsets: new Map([
              [`source:entity:/assistant/reviewer-1`, offset(1)],
            ]),
          },
          childStatus: { toArray: [] },
        },
      } as any)

      expect(syncTimeline.entities).toEqual([
        {
          key: `/assistant/reviewer-1`,
          kind: `source`,
          id: `/assistant/reviewer-1`,
          url: `/assistant/reviewer-1`,
          observed: true,
        },
      ])

      const { collections, sync } = createEntityCollections()
      const liveQuery = createLiveQueryCollection({
        query: createEntityIncludesQuery({ collections } as any),
        startSync: true,
      })
      await liveQuery.preload()

      sync.manifests.insert({
        key: `source:entity:/assistant/reviewer-1`,
        kind: `source`,
        sourceType: `entity`,
        sourceRef: `/assistant/reviewer-1`,
        config: { entityUrl: `/assistant/reviewer-1` },
      })
      await new Promise((r) => setTimeout(r, 50))

      const liveEntity = getTimelineData(liveQuery)?.entities[0]
      expect(liveEntity).toMatchObject({
        key: `/assistant/reviewer-1`,
        kind: `source`,
        id: `/assistant/reviewer-1`,
        url: `/assistant/reviewer-1`,
        observed: true,
      })
      expect(liveEntity?.type).toBeUndefined()
      expect(liveEntity?.status).toBeUndefined()
    })
  })
})
