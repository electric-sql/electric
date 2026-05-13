import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { startGatewayClient } from '../../src/adapter/gateway'

describe(`startGatewayClient`, () => {
  it(`forwards mention as pre_thread_mention via onEvent`, async () => {
    const client = new EventEmitter() as any
    client.login = vi.fn().mockResolvedValue(undefined)
    client.user = { id: `bot1` }
    client.channels = {
      fetch: vi.fn().mockResolvedValue({ isThread: () => false }),
    }

    const onEvent = vi.fn()
    await startGatewayClient({
      token: `t`,
      botUserId: `bot1`,
      onEvent,
      createClient: () => client,
    })

    client.emit(`messageCreate`, {
      id: `m1`,
      channel_id: `c1`,
      author: { id: `u1`, username: `a`, bot: false },
      content: `<@bot1> hello`,
      mentions: [{ id: `bot1` }],
      referenced_message: null,
      attachments: [],
    })

    await new Promise((r) => setImmediate(r))
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      kind: `pre_thread_mention`,
      channelId: `c1`,
    })
  })
})
