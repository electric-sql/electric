import { describe, expect, it } from 'vitest'
import { withTimeout, TimeoutError } from '../../src/transports/timeout'

describe(`withTimeout`, () => {
  it(`resolves when fast enough`, async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7)
  })
  it(`rejects on timeout`, async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toBeInstanceOf(
      TimeoutError
    )
  })
})
