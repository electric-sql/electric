import { describe, expect, it } from 'vitest'
import {
  STREAM_START_POINTER,
  STREAM_TOKEN_PREFIX,
  comparePointers,
  formatPointerOrderToken,
  type EventPointer,
} from '../src/event-pointer'

describe(`formatPointerOrderToken`, () => {
  it(`prefixes every token with the stream marker`, () => {
    const token = formatPointerOrderToken({ offset: `abc`, subOffset: 1 })
    expect(token.startsWith(STREAM_TOKEN_PREFIX)).toBe(true)
  })

  it(`zero-pads offset and sub-offset so lexicographic sort matches stream order`, () => {
    const earlier = formatPointerOrderToken({ offset: `5`, subOffset: 1 })
    const later = formatPointerOrderToken({ offset: `10`, subOffset: 1 })
    // String "5" > "10" naively, but zero-padding fixes that:
    expect(earlier < later).toBe(true)
  })

  it(`treats null offset (stream start) as sorting before any concrete offset`, () => {
    const start = formatPointerOrderToken({ offset: null, subOffset: 1 })
    const concrete = formatPointerOrderToken({ offset: `1`, subOffset: 1 })
    expect(start < concrete).toBe(true)
  })

  it(`breaks ties by sub-offset`, () => {
    const earlier = formatPointerOrderToken({ offset: `abc`, subOffset: 1 })
    const later = formatPointerOrderToken({ offset: `abc`, subOffset: 2 })
    expect(earlier < later).toBe(true)
  })

  it(`is monotonic across a realistic batch sequence`, () => {
    const batches: Array<{ offset: string | null; items: number }> = [
      { offset: null, items: 3 }, // first batch (no prior anchor)
      { offset: `aaa`, items: 2 }, // second batch anchored at aaa
      { offset: `bbb`, items: 4 }, // third batch
    ]
    const tokens: Array<string> = []
    for (const batch of batches) {
      for (let j = 0; j < batch.items; j += 1) {
        tokens.push(
          formatPointerOrderToken({
            offset: batch.offset,
            subOffset: j + 1,
          })
        )
      }
    }
    const sorted = [...tokens].sort()
    expect(sorted).toEqual(tokens)
  })
})

describe(`comparePointers`, () => {
  const cases: Array<{
    name: string
    left: EventPointer
    right: EventPointer
    expected: -1 | 0 | 1
  }> = [
    {
      name: `null offset precedes concrete offset`,
      left: { offset: null, subOffset: 5 },
      right: { offset: `1`, subOffset: 1 },
      expected: -1,
    },
    {
      name: `smaller (zero-padded) offset precedes larger`,
      left: { offset: `5`, subOffset: 99 },
      right: { offset: `10`, subOffset: 1 },
      expected: -1,
    },
    {
      name: `same offset, smaller sub-offset precedes larger`,
      left: { offset: `abc`, subOffset: 1 },
      right: { offset: `abc`, subOffset: 2 },
      expected: -1,
    },
    {
      name: `equal pointers compare zero`,
      left: { offset: `abc`, subOffset: 3 },
      right: { offset: `abc`, subOffset: 3 },
      expected: 0,
    },
  ]
  for (const { name, left, right, expected } of cases) {
    it(name, () => {
      expect(Math.sign(comparePointers(left, right))).toBe(expected)
      // Reverse argument order should flip the sign — except for the
      // equal case (use `?? 0` to avoid the `-0` Object.is footgun in
      // Vitest's `toBe`).
      const reverseExpected = expected === 0 ? 0 : -expected
      expect(Math.sign(comparePointers(right, left))).toBe(reverseExpected)
    })
  }
})

describe(`STREAM_START_POINTER`, () => {
  it(`addresses zero items past the stream-start anchor`, () => {
    expect(STREAM_START_POINTER).toEqual({ offset: null, subOffset: 0 })
  })

  it(`sorts strictly before every other pointer`, () => {
    const anywhere: EventPointer = { offset: null, subOffset: 1 }
    expect(comparePointers(STREAM_START_POINTER, anywhere)).toBeLessThan(0)
  })
})
