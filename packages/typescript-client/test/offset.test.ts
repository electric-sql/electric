import { describe, it, expect } from 'vitest'
import { compareOffset } from '../src/offset'

describe(`compareOffset`, () => {
  it(`should return 1 when the first part of offsetA is greater than offsetB`, () => {
    expect(compareOffset(`2_5`, `1_8`)).toBe(1)
  })

  it(`should return -1 when the first part of offsetA is less than offsetB`, () => {
    expect(compareOffset(`1_5`, `2_8`)).toBe(-1)
  })

  it(`should return 1 when the first part is equal but second part of offsetA is greater`, () => {
    expect(compareOffset(`1_9`, `1_5`)).toBe(1)
  })

  it(`should return -1 when the first part is equal but second part of offsetA is less`, () => {
    expect(compareOffset(`1_2`, `1_8`)).toBe(-1)
  })

  it(`should return 0 when both offsets are the same`, () => {
    expect(compareOffset(`1_5`, `1_5`)).toBe(0)
  })

  it(`should return 1 when offsetA is non-negative and offsetB is '-1'`, () => {
    expect(compareOffset(`1_5`, `-1`)).toBe(1)
  })

  it(`should return -1 when offsetA is '-1' and offsetB is non-negative`, () => {
    expect(compareOffset(`-1`, `1_5`)).toBe(-1)
  })

  it(`should return 0 when both offsets are '- 1'`, () => {
    expect(compareOffset(`-1`, `-1`)).toBe(0)
  })
})
