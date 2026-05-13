import { describe, it, expect, vi } from 'vitest'
import { createDiscordTools } from '../../src/tools/discord'

function fakeRest() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }
}

describe(`discord tools`, () => {
  it(`post_message calls POST /channels/:id/messages`, async () => {
    const rest = fakeRest()
    rest.post.mockResolvedValue({ id: `m1` })
    const [post] = createDiscordTools({ rest: rest as any }).filter(
      (t) => t.name === `post_message`
    )
    const result = await post.execute(`call-1`, {
      channelId: `c1`,
      content: `hi`,
    })
    expect(rest.post).toHaveBeenCalledWith(`/channels/c1/messages`, {
      content: `hi`,
    })
    expect(result.content[0]).toMatchObject({ type: `text` })
    expect(result.details).toMatchObject({ messageId: `m1` })
  })

  it(`add_reaction calls PUT with URL-encoded emoji`, async () => {
    const rest = fakeRest()
    rest.put.mockResolvedValue(null)
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `add_reaction`
    )!
    await tool.execute(`c`, { channelId: `c`, messageId: `m`, emoji: `✅` })
    const [path] = rest.put.mock.calls[0]
    expect(path).toMatch(/\/channels\/c\/messages\/m\/reactions\/.+\/@me$/)
  })

  it(`read_channel_around_message GETs with ?around=&limit=`, async () => {
    const rest = fakeRest()
    rest.get.mockResolvedValue([])
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `read_channel_around_message`
    )!
    await tool.execute(`c`, {
      channelId: `c1`,
      messageId: `m1`,
      before: 20,
      after: 5,
    })
    expect(rest.get).toHaveBeenCalledTimes(2)
    const calls = rest.get.mock.calls.map((c) => c[0])
    expect(
      calls.some(
        (p: string) => p.includes(`before=m1`) && p.includes(`limit=20`)
      )
    ).toBe(true)
    expect(
      calls.some((p: string) => p.includes(`after=m1`) && p.includes(`limit=5`))
    ).toBe(true)
  })

  it(`create_thread POSTs to /channels/:id/messages/:m/threads`, async () => {
    const rest = fakeRest()
    rest.post.mockResolvedValue({ id: `t1` })
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `create_thread`
    )!
    const out = await tool.execute(`c`, {
      channelId: `c1`,
      messageId: `m1`,
      name: `topic`,
      autoArchiveMinutes: 1440,
    })
    expect(rest.post).toHaveBeenCalledWith(`/channels/c1/messages/m1/threads`, {
      name: `topic`,
      auto_archive_duration: 1440,
    })
    expect(out.details).toMatchObject({ threadId: `t1` })
  })
})
