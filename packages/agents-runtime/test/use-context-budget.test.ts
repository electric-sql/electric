import { describe, expect, it, vi } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`budget enforcement`, () => {
  it(`per-source max produces an inline truncation marker for string sources`, async () => {
    const messages = await assembleContext({
      sourceBudget: 100_000,
      sources: {
        skill: {
          content: () => `x`.repeat(100_000),
          max: 400,
          cache: `stable`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toMatch(
      /\[truncated source "skill" chars=\d+\.\.\d+ snapshot=[^\]]+\]/
    )
  })

  it(`sourceBudget overflow truncates timeline oldest-first`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10,
      sources: {
        self: {
          content: () => [
            { role: `user` as const, content: `x`.repeat(200), at: 1 },
            { role: `user` as const, content: `y`.repeat(200), at: 2 },
          ],
          max: 10_000,
          cache: `volatile`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toMatch(
      /\[truncated stream events offset=1\.\.\d+ — use load_timeline_range/
    )
  })

  it(`volatile sources without max are constrained by sourceBudget only`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10,
      sources: {
        self: {
          content: () => [
            { role: `user` as const, content: `x`.repeat(200), at: 1 },
            { role: `user` as const, content: `y`.repeat(200), at: 2 },
          ],
          cache: `volatile`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).not.toMatch(/\[truncated source "self"/)
    expect(output).toMatch(
      /\[truncated stream events offset=1\.\.\d+ — use load_timeline_range/
    )
  })

  it(`does not write a stream event on overflow`, async () => {
    const logger = vi.fn()
    await assembleContext(
      {
        sourceBudget: 10,
        sources: {
          self: {
            content: () => [
              { role: `user` as const, content: `x`.repeat(200), at: 1 },
            ],
            max: 10_000,
            cache: `volatile`,
          },
        },
      },
      { logger }
    )

    expect(logger).toHaveBeenCalled()
  })
})
