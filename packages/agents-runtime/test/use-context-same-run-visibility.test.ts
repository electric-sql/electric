import { describe, expect, it, vi } from 'vitest'
import { createTestHandlerContext } from './helpers/context-test-helpers'

// We need the real useContext assembly path to fire so `content()` actually
// runs. Mock pi-adapter so agent.run() skips the LLM call.
vi.mock(`../src/pi-adapter`, async (importOriginal) => {
  const orig = await importOriginal<any>()
  return {
    ...orig,
    createPiAgentAdapter: () => () => ({ run: () => Promise.resolve() }),
  }
})

describe(`same-run visibility`, () => {
  it(`insertContext is visible to a source's content() callback in the same run`, async () => {
    const { ctx } = createTestHandlerContext({})

    const contentFn = vi.fn(() => {
      const visible = ctx.listContext().map((entry) => entry.id)
      return `visible:${visible.join(`,`)}`
    })

    ctx.useContext({
      sourceBudget: 10_000,
      sources: {
        self: { content: contentFn, max: 10_000, cache: `volatile` },
      },
    })
    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })

    ctx.insertContext(`k`, { name: `note`, content: `inserted value` })
    await ctx.agent.run()

    expect(contentFn).toHaveBeenCalledTimes(1)
    expect(contentFn.mock.results[0]?.value).toBe(`visible:k`)
  })
})
