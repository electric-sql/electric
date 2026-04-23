import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`volatile interleave`, () => {
  it(`merges volatile sources by at`, async () => {
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
      `B3`,
      `A5`,
      `B7`,
    ])
  })
})
