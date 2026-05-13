import { describe, it, expect, vi } from 'vitest'
import { createDiscordRest } from '../src/discord-rest'

describe(`createDiscordRest`, () => {
  it(`posts JSON with Authorization Bot header`, async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ id: `m1` }), { status: 200 })
    )
    const rest = createDiscordRest({ token: `abc`, fetch: fetchFn as any })

    const result = await rest.post(`/channels/123/messages`, { content: `hi` })

    expect(result).toEqual({ id: `m1` })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`https://discord.com/api/v10/channels/123/messages`)
    expect((init as RequestInit).method).toBe(`POST`)
    expect((init as any).headers.Authorization).toBe(`Bot abc`)
    expect((init as any).headers[`Content-Type`]).toBe(`application/json`)
    expect((init as any).body).toBe(JSON.stringify({ content: `hi` }))
  })

  it(`throws DiscordRestError on non-2xx`, async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: `boom` }), { status: 403 })
    )
    const rest = createDiscordRest({ token: `t`, fetch: fetchFn as any })
    await expect(rest.get(`/x`)).rejects.toMatchObject({
      status: 403,
      body: { message: `boom` },
    })
  })

  it(`retries once on 429 honoring retry_after`, async () => {
    const calls: number[] = []
    const fetchFn = vi.fn(async () => {
      calls.push(Date.now())
      if (calls.length === 1) {
        return new Response(JSON.stringify({ retry_after: 0.01 }), {
          status: 429,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const rest = createDiscordRest({ token: `t`, fetch: fetchFn as any })
    const out = await rest.get(`/x`)
    expect(out).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
