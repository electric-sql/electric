import { describe, expect, it } from 'vitest'
import { approxTokens, sliceChars } from '../src/token-budget'

describe(`token-budget`, () => {
  it(`approx tokens ~= chars / 4`, () => {
    expect(approxTokens(``)).toBe(0)
    expect(approxTokens(`abcd`)).toBe(1)
    expect(approxTokens(`a`.repeat(40))).toBe(10)
  })

  it(`sliceChars returns a character-range substring`, () => {
    const value = `abcdefghij`
    expect(sliceChars(value, 0, 4)).toBe(`abcd`)
    expect(sliceChars(value, 4, 10)).toBe(`efghij`)
  })
})
