import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context-assembly'

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
  })
})
