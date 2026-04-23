import { describe, expect, it, vi } from 'vitest'
import {
  createTestHandlerContext,
  getUseContextRegistrations,
} from './helpers/context-test-helpers'

vi.mock(`../src/pi-adapter`, async (importOriginal) => {
  const original = await importOriginal<any>()
  return {
    ...original,
    createPiAgentAdapter: () => () => ({
      run: () => Promise.resolve(),
    }),
  }
})

describe(`useContext memoization`, () => {
  it(`same structural hash keeps registration count flat and latest closure wins`, async () => {
    const { ctx } = createTestHandlerContext({})
    const v1 = vi.fn(() => `v1`)
    const v2 = vi.fn(() => `v2`)

    ctx.useContext({
      sourceBudget: 100,
      sources: { s: { content: v1, max: 100, cache: `stable` } },
    })
    expect(getUseContextRegistrations(ctx)).toBe(1)

    ctx.useContext({
      sourceBudget: 100,
      sources: { s: { content: v2, max: 100, cache: `stable` } },
    })
    expect(getUseContextRegistrations(ctx)).toBe(1)

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(v1).toHaveBeenCalledTimes(0)
    expect(v2).toHaveBeenCalledTimes(1)
  })

  it(`changing max triggers a new registration`, async () => {
    const { ctx } = createTestHandlerContext({})
    const v1 = vi.fn(() => `x`)
    const v2 = vi.fn(() => `x`)

    ctx.useContext({
      sourceBudget: 100,
      sources: { s: { content: v1, max: 10, cache: `stable` } },
    })
    expect(getUseContextRegistrations(ctx)).toBe(1)

    ctx.useContext({
      sourceBudget: 100,
      sources: { s: { content: v2, max: 20, cache: `stable` } },
    })
    expect(getUseContextRegistrations(ctx)).toBe(2)

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(v1).toHaveBeenCalledTimes(0)
    expect(v2).toHaveBeenCalledTimes(1)
  })

  it(`reordering structurally identical source keys does not trigger a new registration`, async () => {
    const { ctx } = createTestHandlerContext({})
    const a = vi.fn(() => `a`)
    const b = vi.fn(() => `b`)

    ctx.useContext({
      sourceBudget: 100,
      sources: {
        alpha: { content: a, max: 10, cache: `stable` },
        beta: { content: b, max: 20, cache: `volatile` },
      },
    })
    expect(getUseContextRegistrations(ctx)).toBe(1)

    ctx.useContext({
      sourceBudget: 100,
      sources: {
        beta: { content: b, max: 20, cache: `volatile` },
        alpha: { content: a, max: 10, cache: `stable` },
      },
    })
    expect(getUseContextRegistrations(ctx)).toBe(1)

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it(`throws for an unknown cache tier at registration time`, () => {
    const { ctx } = createTestHandlerContext({})

    expect(() =>
      ctx.useContext({
        sourceBudget: 100,
        sources: {
          bad: {
            content: () => `x`,
            max: 10,
            cache: `slow_changing` as any,
          },
        },
      })
    ).toThrow(
      `[agent-runtime] useContext: unknown cache tier "slow_changing" for source "bad"; expected pinned | stable | slow-changing | volatile`
    )
  })

  it(`throws for empty sources at registration time`, () => {
    const { ctx } = createTestHandlerContext({})

    expect(() =>
      ctx.useContext({
        sourceBudget: 100,
        sources: {},
      })
    ).toThrow(
      `[agent-runtime] useContext: sources must contain at least one source`
    )
  })

  it(`allows volatile sources to omit max at registration time`, async () => {
    const { ctx } = createTestHandlerContext({})
    const content = vi.fn(() => [
      { role: `user` as const, content: `x`, at: 1 },
    ])

    expect(() =>
      ctx.useContext({
        sourceBudget: 100,
        sources: {
          volatile: {
            content,
            cache: `volatile`,
          },
        },
      })
    ).not.toThrow()

    ctx.useAgent({ systemPrompt: `t`, model: `t`, tools: [] })
    await ctx.agent.run()

    expect(content).toHaveBeenCalledTimes(1)
  })

  it(`throws when a non-volatile source omits max`, () => {
    const { ctx } = createTestHandlerContext({})

    expect(() =>
      ctx.useContext({
        sourceBudget: 100,
        sources: {
          stable: {
            content: () => `x`,
            cache: `stable`,
          } as any,
        },
      })
    ).toThrow(
      `[agent-runtime] useContext: source "stable" must specify max unless cache is volatile`
    )
  })

  it(`throws when a source max is not a positive finite number`, () => {
    const { ctx } = createTestHandlerContext({})

    expect(() =>
      ctx.useContext({
        sourceBudget: 100,
        sources: {
          bad: {
            content: () => `x`,
            max: 0,
            cache: `volatile`,
          },
        },
      })
    ).toThrow(
      `[agent-runtime] useContext: source "bad" max must be a positive finite number`
    )
  })

  it(`throws for a non-positive source budget at registration time`, () => {
    const { ctx } = createTestHandlerContext({})

    expect(() =>
      ctx.useContext({
        sourceBudget: 0,
        sources: {
          ok: {
            content: () => `x`,
            max: 10,
            cache: `stable`,
          },
        },
      })
    ).toThrow(
      `[agent-runtime] useContext: sourceBudget must be a positive finite number`
    )
  })
})
