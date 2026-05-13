import { describe, it, expect, vi } from 'vitest'
import { ensureThreadForMention } from '../../src/adapter/thread'

describe(`ensureThreadForMention`, () => {
  it(`returns thread id when message is already inside a thread`, async () => {
    const rest = { post: vi.fn() }
    const id = await ensureThreadForMention({
      rest: rest as any,
      message: { id: `m`, channel_id: `c`, channel_is_thread: true },
    })
    expect(id).toBe(`c`)
    expect(rest.post).not.toHaveBeenCalled()
  })

  it(`creates a thread from the message when not yet in one`, async () => {
    const rest = { post: vi.fn().mockResolvedValue({ id: `new-thread` }) }
    const id = await ensureThreadForMention({
      rest: rest as any,
      message: {
        id: `m1`,
        channel_id: `c1`,
        channel_is_thread: false,
        threadName: `Topic`,
      },
    })
    expect(id).toBe(`new-thread`)
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/c1/messages/m1/threads`,
      expect.objectContaining({ name: `Topic` })
    )
  })
})
