import { describe, it, expect } from 'vitest'
import { discordWakeMessageSchema } from '../src/wake-message'

describe(`discordWakeMessageSchema`, () => {
  it(`accepts a mention payload`, () => {
    const parsed = discordWakeMessageSchema.parse({
      kind: `mention`,
      threadId: `t1`,
      channelId: `c1`,
      userId: `u1`,
      content: `hello`,
      primeMessages: [
        { id: `m0`, author: `alice`, content: `prior`, timestamp: 1 },
      ],
    })
    expect(parsed.kind).toBe(`mention`)
  })

  it(`accepts thread_close with only threadId`, () => {
    const parsed = discordWakeMessageSchema.parse({
      kind: `thread_close`,
      threadId: `t1`,
    })
    expect(parsed.kind).toBe(`thread_close`)
  })

  it(`rejects payload without kind`, () => {
    expect(() => discordWakeMessageSchema.parse({ threadId: `t1` })).toThrow()
  })
})
