import { describe, it, expect } from 'vitest'
import { mapMessageCreate } from '../../src/adapter/gateway-mapper'

describe(`mapMessageCreate`, () => {
  const botUserId = `bot1`

  it(`maps an @bot mention in a regular channel to a mention wake (no threadId yet)`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m1`,
        channel_id: `c1`,
        author: { id: `u1`, username: `alice`, bot: false },
        content: `<@bot1> hello`,
        mentions: [{ id: botUserId }],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: false,
    })
    expect(out).toMatchObject({
      kind: `pre_thread_mention`,
      channelId: `c1`,
      messageId: `m1`,
      userId: `u1`,
      content: `hello`,
    })
  })

  it(`maps a message inside a thread to thread_msg`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m2`,
        channel_id: `t1`,
        author: { id: `u1`, username: `alice`, bot: false },
        content: `follow-up`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: true,
    })
    expect(out).toMatchObject({
      kind: `thread_msg`,
      threadId: `t1`,
      content: `follow-up`,
    })
  })

  it(`ignores messages from the bot itself`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m`,
        channel_id: `t`,
        author: { id: botUserId, username: `bot`, bot: true },
        content: `hi`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: true,
    })
    expect(out).toBeNull()
  })

  it(`ignores non-mention messages in a regular channel`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m`,
        channel_id: `c`,
        author: { id: `u`, username: `a`, bot: false },
        content: `hello world`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: false,
    })
    expect(out).toBeNull()
  })
})
