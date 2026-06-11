import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  normalizeTimeoutMs,
  withTimeout,
} from '../../src/transports/timeout'

describe(`withTimeout`, () => {
  it(`resolves when the inner promise resolves first`, async () => {
    expect(await withTimeout(Promise.resolve(1), 100)).toBe(1)
  })
  it(`rejects with kind=timeout when slower than the budget`, async () => {
    await expect(
      withTimeout(new Promise((r) => setTimeout(() => r(1), 50)), 5)
    ).rejects.toMatchObject({ kind: `timeout` })
  })
  it(`passes through rejections unchanged`, async () => {
    await expect(
      withTimeout(Promise.reject(new Error(`boom`)), 100)
    ).rejects.toThrow(`boom`)
  })
  it(`defaults to 2 minutes and clamps to a 10-minute maximum`, () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(MAX_TIMEOUT_MS).toBe(600_000)
    expect(normalizeTimeoutMs(undefined)).toBe(120_000)
    expect(normalizeTimeoutMs(900_000)).toBe(600_000)
  })
})
