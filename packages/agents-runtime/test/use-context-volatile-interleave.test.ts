import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context-assembly'
import {
  defaultProjection,
  materializeTimeline,
} from '../src/timeline-context'
import type {
  IncludesInboxMessage,
  IncludesRun,
  IncludesSignal,
} from '../src/entity-timeline'

describe(`volatile interleave`, () => {
  it(`preserves volatile source order and per-source message order`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10_000,
      sources: {
        a: {
          content: () => [
            { role: `user` as const, content: `A1`, at: 1 },
            { role: `user` as const, content: `A5`, at: 5 },
          ],
          max: 1_000,
          cache: `volatile`,
        },
        b: {
          content: () => [
            { role: `user` as const, content: `B3`, at: 3 },
            { role: `user` as const, content: `B7`, at: 7 },
          ],
          max: 1_000,
          cache: `volatile`,
        },
      },
    })

    expect(messages.map((message) => message.content)).toEqual([
      `A1`,
      `A5`,
      `B3`,
      `B7`,
    ])
    expect(messages.map((message) => message.at)).toEqual([1, 5, 3, 7])
  })

  it(`concatenates three volatile sources in registration order`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10_000,
      sources: {
        alpha: {
          content: () => [
            { role: `user` as const, content: `A1`, at: 9 },
          ],
          max: 1_000,
          cache: `volatile`,
        },
        beta: {
          content: () => [
            { role: `user` as const, content: `B1`, at: 2 },
            { role: `user` as const, content: `B2`, at: 4 },
          ],
          max: 1_000,
          cache: `volatile`,
        },
        gamma: {
          content: () => [
            { role: `user` as const, content: `C1`, at: 1 },
          ],
          max: 1_000,
          cache: `volatile`,
        },
      },
    })

    expect(messages.map((message) => message.content)).toEqual([
      `A1`,
      `B1`,
      `B2`,
      `C1`,
    ])
    expect(messages.map((message) => message.at)).toEqual([9, 2, 4, 1])
  })

  it(`preserves semantic order returned by a volatile source when at values race`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10_000,
      sources: {
        conversation: {
          content: () => [
            { role: `user` as const, content: `start`, at: 1 },
            { role: `assistant` as const, content: `partial`, at: 3 },
            {
              role: `user` as const,
              content: `<agent_signal signal="SIGINT" />`,
              at: 2,
            },
            { role: `user` as const, content: `continue`, at: 4 },
          ],
          cache: `volatile`,
        },
      },
    })

    expect(messages.map((message) => message.content)).toEqual([
      `start`,
      `partial`,
      `<agent_signal signal="SIGINT" />`,
      `continue`,
    ])
    expect(messages.map((message) => message.at)).toEqual([1, 3, 2, 4])
  })

  it(`end-to-end: timeline SIGINT reorder survives assembleContext`, async () => {
    function order(index: number): string {
      return index.toString().padStart(20, `0`)
    }

    const inbox: Array<IncludesInboxMessage> = [
      {
        key: `msg-1`,
        order: order(1),
        from: `user`,
        payload: `start`,
        timestamp: `2026-06-01T00:00:00.000Z`,
      },
      {
        key: `msg-2`,
        order: order(4),
        from: `user`,
        payload: `continue`,
        timestamp: `2026-06-01T00:00:03.000Z`,
      },
    ]
    const signals: Array<IncludesSignal> = [
      {
        key: `sig-1`,
        order: order(2),
        signal: `SIGINT`,
        status: `handled`,
        timestamp: `2026-06-01T00:00:02.000Z`,
        outcome: `aborted`,
      },
    ]
    const runs: Array<IncludesRun> = [
      {
        key: `run-1`,
        order: order(3),
        status: `completed`,
        finish_reason: `aborted`,
        texts: [
          {
            key: `text-1`,
            run_id: `run-1`,
            order: order(5),
            status: `completed`,
            text: `partial response`,
          },
        ],
        toolCalls: [],
        steps: [],
        errors: [],
      },
    ]

    const timelineItems = materializeTimeline({
      runs,
      inbox,
      wakes: [],
      signals,
      contextInserted: [],
      contextRemoved: [],
      entities: [],
    })

    const volatileContent = timelineItems.flatMap((item) => {
      const msgs = defaultProjection(item) ?? []
      return msgs.map((m) => ({ ...m, at: item.at }))
    })

    const messages = await assembleContext({
      sourceBudget: 10_000,
      sources: {
        conversation: {
          content: () => volatileContent,
          cache: `volatile`,
        },
      },
    })

    expect(messages.map((m) => m.content)).toEqual([
      `start`,
      `partial response`,
      expect.stringContaining(`SIGINT`),
      `continue`,
    ])
    expect(messages.map((m) => m.at)).toEqual([1, 3, 2, 4])
  })
})
