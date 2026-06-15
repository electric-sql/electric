import { describe, expect, it } from 'vitest'
import {
  CONTEXT_USAGE_BACKGROUND_START,
  CONTEXT_USAGE_HARD_CEILING,
  computeContextUsage,
  contextUsageLevel,
  formatContextUsagePercent,
  formatContextBudgetNotice,
  selectLatestContextUsage,
  shouldSurfaceContextBudget,
  withContextBudgetNotice,
} from '../src/token-accountant'
import type { LLMMessage } from '../src/types'

describe(`computeContextUsage`, () => {
  it(`sums input + output against the window`, () => {
    const usage = computeContextUsage({
      contextInputTokens: 40_000,
      outputTokens: 10_000,
      contextWindow: 100_000,
    })
    expect(usage).toEqual({
      usedTokens: 50_000,
      contextWindow: 100_000,
      ratio: 0.5,
    })
  })

  it(`treats output as optional`, () => {
    const usage = computeContextUsage({
      contextInputTokens: 25_000,
      contextWindow: 100_000,
    })
    expect(usage?.usedTokens).toBe(25_000)
    expect(usage?.ratio).toBe(0.25)
  })

  it(`clamps the ratio to 1 when over the window`, () => {
    const usage = computeContextUsage({
      contextInputTokens: 120_000,
      outputTokens: 20_000,
      contextWindow: 100_000,
    })
    expect(usage?.ratio).toBe(1)
    // usedTokens is the true (un-clamped) count for the tooltip.
    expect(usage?.usedTokens).toBe(140_000)
  })

  it(`returns null for an unknown or non-positive window`, () => {
    expect(
      computeContextUsage({ contextInputTokens: 10, contextWindow: 0 })
    ).toBeNull()
    expect(
      computeContextUsage({
        contextInputTokens: 10,
        contextWindow: Number.NaN,
      })
    ).toBeNull()
  })
})

describe(`contextUsageLevel`, () => {
  it(`is normal below the background-compaction threshold`, () => {
    expect(contextUsageLevel(0)).toBe(`normal`)
    expect(contextUsageLevel(CONTEXT_USAGE_BACKGROUND_START - 0.01)).toBe(
      `normal`
    )
  })

  it(`is warning between background start and the hard ceiling`, () => {
    expect(contextUsageLevel(CONTEXT_USAGE_BACKGROUND_START)).toBe(`warning`)
    expect(contextUsageLevel(CONTEXT_USAGE_HARD_CEILING - 0.01)).toBe(`warning`)
  })

  it(`is critical at or above the hard ceiling`, () => {
    expect(contextUsageLevel(CONTEXT_USAGE_HARD_CEILING)).toBe(`critical`)
    expect(contextUsageLevel(1)).toBe(`critical`)
  })
})

describe(`formatContextUsagePercent`, () => {
  it(`renders a whole-percent label`, () => {
    expect(formatContextUsagePercent(0)).toBe(`0%`)
    expect(formatContextUsagePercent(0.426)).toBe(`43%`)
    expect(formatContextUsagePercent(1)).toBe(`100%`)
  })
})

describe(`selectLatestContextUsage`, () => {
  it(`picks the step with the highest _seq that reported usage`, () => {
    const usage = selectLatestContextUsage([
      { _seq: 1, context_input_tokens: 10_000, context_window: 100_000 },
      {
        _seq: 3,
        context_input_tokens: 60_000,
        output_tokens: 5_000,
        context_window: 100_000,
      },
      { _seq: 2, context_input_tokens: 30_000, context_window: 100_000 },
    ])
    expect(usage?.usedTokens).toBe(65_000)
    expect(usage?.ratio).toBe(0.65)
  })

  it(`ignores steps that have not reported context usage`, () => {
    const usage = selectLatestContextUsage([
      { _seq: 5, output_tokens: 9 }, // started, no usage yet — must be skipped
      { _seq: 2, context_input_tokens: 40_000, context_window: 100_000 },
    ])
    expect(usage?.usedTokens).toBe(40_000)
  })

  it(`returns null when no step has reported usage`, () => {
    expect(selectLatestContextUsage([])).toBeNull()
    expect(selectLatestContextUsage([{ _seq: 1, output_tokens: 5 }])).toBeNull()
  })
})

describe(`shouldSurfaceContextBudget`, () => {
  it(`is false below 25% and true at/above it`, () => {
    expect(shouldSurfaceContextBudget(0.1)).toBe(false)
    expect(shouldSurfaceContextBudget(0.2499)).toBe(false)
    expect(shouldSurfaceContextBudget(0.25)).toBe(true)
    expect(shouldSurfaceContextBudget(0.9)).toBe(true)
  })
})

describe(`formatContextBudgetNotice`, () => {
  it(`states remaining tokens and percent left`, () => {
    const usage = computeContextUsage({
      contextInputTokens: 75_000,
      contextWindow: 100_000,
    })!
    // 100k window, 75k used → 25k (25%) remaining.
    expect(formatContextBudgetNotice(usage)).toBe(
      `You have about 25k tokens (25%) of the context window remaining.`
    )
  })

  it(`never reports negative remaining when over the window`, () => {
    const usage = computeContextUsage({
      contextInputTokens: 130_000,
      contextWindow: 100_000,
    })!
    expect(formatContextBudgetNotice(usage)).toBe(
      `You have about 0 tokens (0%) of the context window remaining.`
    )
  })
})

describe(`withContextBudgetNotice`, () => {
  const user = (text: string): LLMMessage => ({ role: `user`, content: text })
  const lowUsage = computeContextUsage({
    contextInputTokens: 10_000,
    contextWindow: 100_000,
  })
  const highUsage = computeContextUsage({
    contextInputTokens: 80_000,
    contextWindow: 100_000,
  })

  it(`leaves messages unchanged when usage is unknown`, () => {
    const messages = [user(`hello`)]
    expect(withContextBudgetNotice(messages, null)).toEqual(messages)
  })

  it(`leaves messages unchanged below the first threshold`, () => {
    const messages = [user(`hello`)]
    expect(withContextBudgetNotice(messages, lowUsage)).toEqual(messages)
  })

  it(`injects the notice just before the final message`, () => {
    const messages = [user(`first`), user(`latest`)]
    const result = withContextBudgetNotice(messages, highUsage)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(user(`first`))
    expect(result[1]?.role).toBe(`user`)
    expect(String(result[1]?.content)).toContain(`<token_budget>`)
    // The final message (the live turn) stays last so runInput detection
    // that reads `.at(-1)` is unaffected.
    expect(result[2]).toEqual(user(`latest`))
  })

  it(`emits just the notice when there are no messages yet`, () => {
    const result = withContextBudgetNotice([], highUsage)
    expect(result).toHaveLength(1)
    expect(String(result[0]?.content)).toContain(`token_budget`)
  })
})
