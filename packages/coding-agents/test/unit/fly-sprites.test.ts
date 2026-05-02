import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { FlySpriteProvider } from '../../src/providers/fly-sprites'

const FAKE_TOKEN = `tok_test_xyz`

function mockResponses(steps: Array<unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn()
  for (const r of steps) {
    fn.mockResolvedValueOnce(
      new Response(typeof r === `object` ? JSON.stringify(r) : (r as string), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
  }
  return fn
}

describe(`FlySpriteProvider`, () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(`throws if SPRITES_TOKEN is unset and no token override`, () => {
    const oldToken = process.env.SPRITES_TOKEN
    delete process.env.SPRITES_TOKEN
    expect(() => new FlySpriteProvider()).toThrow(/SPRITES_TOKEN/)
    if (oldToken !== undefined) process.env.SPRITES_TOKEN = oldToken
  })

  it(`accepts an explicit token option`, () => {
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(p.name).toBe(`fly-sprites`)
  })

  it(`destroy() calls DELETE /sprites/{name} for the agentId-mapped sprite`, async () => {
    global.fetch = mockResponses([
      { sprites: [{ id: `spr_x`, name: `coding-agent-foo` }] },
      ``, // delete returns empty
    ]) as unknown as typeof fetch

    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    await p.destroy(`/coding-agent/foo`)
    const calls = (global.fetch as any).mock.calls as Array<
      [string, RequestInit]
    >
    const deleteCall = calls.find((c) => c[1].method === `DELETE`)
    expect(deleteCall?.[0]).toBe(
      `https://api.sprites.dev/v1/sprites/coding-agent-foo`
    )
  })

  it(`status() returns 'unknown' when sprite not found`, async () => {
    global.fetch = mockResponses([{ sprites: [] }]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(await p.status(`/coding-agent/missing`)).toBe(`unknown`)
  })

  it(`status() returns 'running' for sprites in any active or sleeping state`, async () => {
    global.fetch = mockResponses([
      { sprites: [{ id: `spr_a`, name: `coding-agent-a`, status: `running` }] },
      { id: `spr_a`, name: `coding-agent-a`, status: `running` },
    ]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(await p.status(`/coding-agent/a`)).toBe(`running`)
  })

  it(`recover() lists sprites with the coding-agent prefix`, async () => {
    global.fetch = mockResponses([
      {
        sprites: [
          { id: `spr_a`, name: `coding-agent-foo`, status: `running` },
          { id: `spr_b`, name: `coding-agent-bar`, status: `sleeping` },
        ],
      },
    ]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    const recovered = await p.recover()
    expect(recovered).toHaveLength(2)
    expect(recovered.map((r) => r.target)).toEqual([`sprites`, `sprites`])
    const url = (global.fetch as any).mock.calls[0]![0] as string
    expect(url).toContain(`name_prefix=coding-agent-`)
  })

  it(`cloneWorkspace is NOT defined (deferred to v1.5)`, () => {
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect((p as any).cloneWorkspace).toBeUndefined()
  })
})
