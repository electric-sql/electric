import { describe, expect, it } from 'vitest'
import {
  buildTimelineMessages,
  timelineToMessages,
} from '../src/timeline-context'
import type { EntityStreamDB } from '../src/entity-stream-db'
import type {
  IncludesInboxMessage,
  IncludesRun,
  IncludesWakeMessage,
} from '../src/entity-timeline'

function order(index: number): string {
  return index.toString().padStart(20, `0`)
}

function offset(index: number): string {
  return `0000000000000000_${index.toString().padStart(16, `0`)}`
}

describe(`timeline context`, () => {
  it(`buildTimelineMessages returns an empty array for empty inputs`, () => {
    expect(
      buildTimelineMessages({
        runs: [],
        inbox: [],
        wakes: [],
      })
    ).toEqual([])
  })

  it(`buildTimelineMessages converts shared timeline arrays into LLM messages`, () => {
    const runs: Array<IncludesRun> = [
      {
        key: `run-1`,
        order: order(2),
        status: `completed`,
        texts: [
          {
            key: `text-empty`,
            run_id: `run-1`,
            order: order(3),
            status: `completed`,
            text: ``,
          },
          {
            key: `text-1`,
            run_id: `run-1`,
            order: order(4),
            status: `completed`,
            text: `Hello there`,
          },
        ],
        toolCalls: [
          {
            key: `tc-1`,
            run_id: `run-1`,
            order: order(5),
            tool_name: `search`,
            status: `completed`,
            args: { q: `electric-agents` },
            result: { hits: 3 },
          },
        ],
        steps: [],
        errors: [],
      },
    ]
    const inbox: Array<IncludesInboxMessage> = [
      {
        key: `msg-1`,
        order: order(1),
        from: `user`,
        payload: `hi`,
        timestamp: `2026-03-28T00:00:00.000Z`,
      },
    ]
    const wakes: Array<IncludesWakeMessage> = [
      {
        key: `wake-1`,
        order: order(6),
        payload: {
          type: `wake`,
          timestamp: `2026-03-28T00:01:00.000Z`,
          source: `/worker/article-1`,
          timeout: false,
          changes: [
            {
              collection: `runs`,
              kind: `update`,
              key: `run-0`,
            },
          ],
        },
      },
    ]

    expect(buildTimelineMessages({ runs, inbox, wakes })).toEqual([
      { role: `user`, content: `hi` },
      { role: `assistant`, content: `Hello there` },
      {
        role: `tool_call`,
        content: `{"q":"electric-agents"}`,
        toolCallId: `tc-1`,
        toolName: `search`,
        toolArgs: { q: `electric-agents` },
      },
      {
        role: `tool_result`,
        content: `{"hits":3}`,
        toolCallId: `tc-1`,
        isError: false,
      },
      {
        role: `user`,
        content: `{"type":"wake","timestamp":"2026-03-28T00:01:00.000Z","source":"/worker/article-1","timeout":false,"changes":[{"collection":"runs","kind":"update","key":"run-0"}]}`,
      },
    ])
  })

  it(`buildTimelineMessages keeps pending tool calls without emitting tool results`, () => {
    expect(
      buildTimelineMessages({
        runs: [
          {
            key: `run-1`,
            order: order(1),
            status: `completed`,
            texts: [],
            toolCalls: [
              {
                key: `tc-pending`,
                run_id: `run-1`,
                order: order(2),
                tool_name: `lookup`,
                status: `executing`,
                args: { id: `user-1` },
              },
            ],
            steps: [],
            errors: [],
          },
        ],
        inbox: [],
        wakes: [],
      })
    ).toEqual([
      {
        role: `tool_call`,
        content: `{"id":"user-1"}`,
        toolCallId: `tc-pending`,
        toolName: `lookup`,
        toolArgs: { id: `user-1` },
      },
    ])
  })

  it(`buildTimelineMessages keeps each run grouped together ahead of later inbox rows`, () => {
    expect(
      buildTimelineMessages({
        runs: [
          {
            key: `run-1`,
            order: order(2),
            status: `completed`,
            texts: [
              {
                key: `text-1`,
                run_id: `run-1`,
                order: order(4),
                status: `completed`,
                text: `assistant reply`,
              },
            ],
            toolCalls: [
              {
                key: `tc-1`,
                run_id: `run-1`,
                order: order(5),
                tool_name: `search`,
                status: `completed`,
                args: { q: `rome` },
                result: { hits: 2 },
              },
            ],
            steps: [],
            errors: [],
          },
        ],
        inbox: [
          {
            key: `msg-0`,
            order: order(1),
            from: `user`,
            payload: `start`,
            timestamp: `2026-03-28T00:00:00.000Z`,
          },
          {
            key: `msg-1`,
            order: order(3),
            from: `user`,
            payload: `follow up`,
            timestamp: `2026-03-28T00:00:01.000Z`,
          },
        ],
        wakes: [],
      })
    ).toEqual([
      { role: `user`, content: `start` },
      { role: `assistant`, content: `assistant reply` },
      {
        role: `tool_call`,
        content: `{"q":"rome"}`,
        toolCallId: `tc-1`,
        toolName: `search`,
        toolArgs: { q: `rome` },
      },
      {
        role: `tool_result`,
        content: `{"hits":2}`,
        toolCallId: `tc-1`,
        isError: false,
      },
      { role: `user`, content: `follow up` },
    ])
  })

  it(`timelineToMessages reads the shared entity timeline shape from the db`, () => {
    const db = {
      collections: {
        runs: {
          toArray: [
            {
              key: `run-1`,
              status: `completed`,
              finish_reason: `stop`,
            },
          ],
          __electricRowOffsets: new Map([[`run-1`, offset(2)]]),
        },
        texts: {
          toArray: [
            {
              key: `text-1`,
              run_id: `run-1`,
              status: `completed`,
            },
          ],
          __electricRowOffsets: new Map([[`text-1`, offset(3)]]),
        },
        textDeltas: {
          toArray: [
            {
              key: `td-1`,
              text_id: `text-1`,
              delta: `Hello`,
            },
            {
              key: `td-2`,
              text_id: `text-1`,
              delta: ` world`,
            },
          ],
          __electricRowOffsets: new Map([
            [`td-1`, offset(4)],
            [`td-2`, offset(5)],
          ]),
        },
        toolCalls: {
          toArray: [
            {
              key: `tc-1`,
              run_id: `run-1`,
              tool_name: `lookup`,
              status: `failed`,
              args: { key: `user-1` },
              error: `missing`,
            },
          ],
          __electricRowOffsets: new Map([[`tc-1`, offset(6)]]),
        },
        steps: { toArray: [] },
        errors: { toArray: [] },
        inbox: {
          toArray: [
            {
              key: `msg-1`,
              from: `user`,
              payload: { text: `summarize` },
              timestamp: `2026-03-28T00:00:00.000Z`,
            },
          ],
          __electricRowOffsets: new Map([[`msg-1`, offset(1)]]),
        },
        wakes: {
          toArray: [
            {
              key: `wake-1`,
              timestamp: `2026-03-28T00:01:00.000Z`,
              source: `/worker/summary-1`,
              timeout: false,
              changes: [
                {
                  collection: `runs`,
                  kind: `update`,
                  key: `run-0`,
                },
              ],
            },
          ],
          __electricRowOffsets: new Map([[`wake-1`, offset(7)]]),
        },
        contextInserted: { toArray: [], __electricRowOffsets: new Map() },
        contextRemoved: { toArray: [], __electricRowOffsets: new Map() },
        manifests: { toArray: [], __electricRowOffsets: new Map() },
        childStatus: { toArray: [], __electricRowOffsets: new Map() },
      },
    } as unknown as EntityStreamDB

    expect(timelineToMessages(db)).toEqual([
      { role: `user`, content: `{"text":"summarize"}` },
      { role: `assistant`, content: `Hello world` },
      {
        role: `tool_call`,
        content: `{"key":"user-1"}`,
        toolCallId: `tc-1`,
        toolName: `lookup`,
        toolArgs: { key: `user-1` },
      },
      {
        role: `tool_result`,
        content: `missing`,
        toolCallId: `tc-1`,
        isError: true,
      },
      {
        role: `user`,
        content: `{"type":"wake","timestamp":"2026-03-28T00:01:00.000Z","source":"/worker/summary-1","timeout":false,"changes":[{"collection":"runs","kind":"update","key":"run-0"}]}`,
      },
    ])
  })

  it(`timelineToMessages handles an empty entity timeline`, () => {
    const db = {
      collections: {
        runs: { toArray: [] },
        texts: { toArray: [] },
        textDeltas: { toArray: [] },
        toolCalls: { toArray: [] },
        steps: { toArray: [] },
        errors: { toArray: [] },
        inbox: { toArray: [] },
        wakes: { toArray: [] },
        contextInserted: { toArray: [] },
        contextRemoved: { toArray: [] },
        manifests: { toArray: [] },
        childStatus: { toArray: [] },
      },
    } as unknown as EntityStreamDB

    expect(timelineToMessages(db)).toEqual([])
  })
})
