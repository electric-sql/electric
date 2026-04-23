import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`timestamped message validation`, () => {
  it(`throws when a source returns a non-finite at value`, async () => {
    await expect(
      assembleContext({
        sourceBudget: 100,
        sources: {
          bad: {
            content: () => [
              {
                role: `user` as const,
                content: `x`,
                at: Number.NaN,
              },
            ],
            max: 100,
            cache: `volatile`,
          },
        },
      })
    ).rejects.toThrow(
      `[agent-runtime] context source returned a timestamped message with non-finite at`
    )
  })
})
