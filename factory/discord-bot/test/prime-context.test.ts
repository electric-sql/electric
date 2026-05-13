import { describe, it, expect } from 'vitest'
import { buildPrimeContextEntries } from '../src/prime-context'

describe(`buildPrimeContextEntries`, () => {
  it(`groups messages into a single context entry with channel header`, () => {
    const entries = buildPrimeContextEntries({
      channelId: `c1`,
      threadId: `t1`,
      messages: [
        { id: `m1`, author: `alice`, content: `hello`, timestamp: 1 },
        { id: `m2`, author: `bob`, content: `world`, timestamp: 2 },
      ],
    })
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.key).toBe(`discord-prime-c1-t1`)
    expect(e.attrs.role).toBe(`background`)
    expect(typeof e.text).toBe(`string`)
    expect(e.text).toContain(`alice: hello`)
    expect(e.text).toContain(`bob: world`)
  })

  it(`returns empty when no messages`, () => {
    expect(
      buildPrimeContextEntries({ channelId: `c`, threadId: `t`, messages: [] })
    ).toEqual([])
  })
})
