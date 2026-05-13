import { describe, it, expect, vi } from 'vitest'
import { createWakeWebhookPoster } from '../../src/adapter/webhook'

describe(`createWakeWebhookPoster`, () => {
  it(`POSTs the wake payload with auth header`, async () => {
    const fetchFn = vi.fn(async () => new Response(`ok`, { status: 200 }))
    const post = createWakeWebhookPoster({
      agentsServerUrl: `http://a`,
      agentsServerToken: `s`,
      fetch: fetchFn as any,
    })

    await post({
      entityType: `discord-bot`,
      entityId: `t1`,
      message: { kind: `thread_close`, threadId: `t1` },
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(`http://a/webhook/discord-bot`)
    expect((init as any).headers.Authorization).toBe(`Bearer s`)
    expect((init as any).method).toBe(`POST`)
  })

  it(`throws on non-2xx`, async () => {
    const fetchFn = vi.fn(async () => new Response(`bad`, { status: 500 }))
    const post = createWakeWebhookPoster({
      agentsServerUrl: `http://a`,
      agentsServerToken: `s`,
      fetch: fetchFn as any,
    })
    await expect(
      post({
        entityType: `discord-bot`,
        entityId: `t`,
        message: { kind: `thread_close`, threadId: `t` },
      })
    ).rejects.toThrow(/500/)
  })
})
