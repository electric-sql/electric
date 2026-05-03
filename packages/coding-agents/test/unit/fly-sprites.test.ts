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

  // Regression: sprites.dev rejects names not matching [a-z0-9-]+. nanoid(10)
  // (used for agent IDs in the runtime) produces mixed-case strings, so the
  // sanitiser must lowercase. A previous version emitted 'coding-agent-2wLbrqPwAw'
  // and got 400 'invalid sprite name format' from the live API.
  describe(`sprite name format (regression: 2026-05-03)`, () => {
    const SPRITE_NAME_RE = /^[a-z0-9-]+$/
    const cases: Array<{ agentId: string; expected?: string }> = [
      {
        agentId: `/coding-agent/2wLbrqPwAw`,
        expected: `coding-agent-2wlbrqpwaw`,
      },
      { agentId: `/coding-agent/UPPER123`, expected: `coding-agent-upper123` },
      { agentId: `/coding-agent/has_underscores` },
      { agentId: `/coding-agent/has.dots` },
      {
        agentId: `/coding-agent/HXLSm6dBT9`,
        expected: `coding-agent-hxlsm6dbt9`,
      },
    ]

    for (const { agentId, expected } of cases) {
      it(`createSprite POSTs a name matching /^[a-z0-9-]+$/ for agentId='${agentId}'`, async () => {
        const fetchMock = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: `spr_x`,
              name: `placeholder`,
              url: `https://placeholder.sprites.app`,
            }),
            {
              status: 201,
              headers: { 'content-type': `application/json` },
            }
          )
        )
        // listSprites lookup runs before createSprite — return empty.
        fetchMock.mockResolvedValueOnce(
          new Response(JSON.stringify({ sprites: [] }), {
            status: 200,
            headers: { 'content-type': `application/json` },
          })
        )
        // Then createSprite — return a fake sprite.
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: `spr_x`,
              name: `placeholder`,
              url: `https://placeholder.sprites.app`,
            }),
            {
              status: 201,
              headers: { 'content-type': `application/json` },
            }
          )
        )
        global.fetch = fetchMock as unknown as typeof fetch

        const p = new FlySpriteProvider({ token: FAKE_TOKEN })
        // start() will fail at exec-bootstrap (no real WS) but we only care
        // about the createSprite call having happened with a valid name.
        await p
          .start({
            agentId,
            workspace: { type: `volume`, name: `vol` },
            workspaceIdentity: `sprite:${agentId}`,
            env: {},
          })
          .catch(() => undefined)

        const calls = (global.fetch as any).mock.calls as Array<
          [string, RequestInit]
        >
        const createCall = calls.find(
          (c) => c[1].method === `POST` && String(c[0]).endsWith(`/v1/sprites`)
        )
        expect(
          createCall,
          `createSprite POST should have happened`
        ).toBeDefined()
        const body = JSON.parse(String(createCall![1].body)) as { name: string }
        expect(body.name).toMatch(SPRITE_NAME_RE)
        if (expected !== undefined) expect(body.name).toBe(expected)
      })
    }
  })
})
