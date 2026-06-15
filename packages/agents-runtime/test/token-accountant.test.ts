import { describe, expect, it } from 'vitest'
import {
  CONTEXT_USAGE_BACKGROUND_START,
  CONTEXT_USAGE_HARD_CEILING,
  computeContextUsage,
  contextUsageLevel,
  formatContextUsagePercent,
} from '../src/token-accountant'

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
