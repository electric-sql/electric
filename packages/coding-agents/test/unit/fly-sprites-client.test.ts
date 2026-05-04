import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SpritesApiClient } from '../../src/providers/fly-sprites/api-client'

describe(`SpritesApiClient`, () => {
  let originalFetch: typeof fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(`POST /sprites with name + idle_timeout`, async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: `spr_abc`, name: `coding-agent-x` }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.createSprite({
      name: `coding-agent-x`,
      idleTimeoutSecs: 300,
    })
    expect(r.id).toBe(`spr_abc`)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.sprites.dev/v1/sprites`,
      expect.objectContaining({
        method: `POST`,
        headers: expect.objectContaining({
          authorization: `Bearer tok_xyz`,
          'content-type': `application/json`,
        }),
        body: expect.stringContaining(`coding-agent-x`),
      })
    )
  })

  it(`GET /sprites/{name}`, async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: `spr_abc`, status: `running` }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.getSprite(`coding-agent-x`)
    expect(r.status).toBe(`running`)
  })

  it(`GET /sprites?name_prefix=...`, async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          sprites: [{ id: `spr_a`, name: `coding-agent-1` }],
        }),
        {
          status: 200,
          headers: { 'content-type': `application/json` },
        }
      )
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.listSprites({ namePrefix: `coding-agent-` })
    expect(r.sprites).toHaveLength(1)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain(`name_prefix=coding-agent-`)
  })

  it(`DELETE /sprites/{name}`, async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const c = new SpritesApiClient({ token: `tok_xyz` })
    await c.deleteSprite(`coding-agent-x`)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.sprites.dev/v1/sprites/coding-agent-x`,
      expect.objectContaining({ method: `DELETE` })
    )
  })

  it(`throws with status + body on non-2xx`, async () => {
    fetchMock.mockResolvedValue(
      new Response(`forbidden`, { status: 403, statusText: `Forbidden` })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    await expect(c.getSprite(`spr_x`)).rejects.toThrow(/403.*forbidden/i)
  })
})
