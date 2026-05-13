import { describe, it, expect, vi } from 'vitest'
import { processGatewayEvent } from '../../src/adapter/host-node'

describe(`processGatewayEvent`, () => {
  it(`starts a thread on pre_thread_mention then posts a wake`, async () => {
    const rest = {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn().mockResolvedValue({ id: `new-thread` }),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const postWake = vi.fn().mockResolvedValue(undefined)
    await processGatewayEvent(
      {
        kind: `pre_thread_mention`,
        channelId: `c1`,
        messageId: `m1`,
        userId: `u1`,
        content: `hello`,
      },
      {
        rest: rest as any,
        postWake,
        primeMessageLimit: 5,
      }
    )
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/c1/messages/m1/threads`,
      expect.objectContaining({ name: expect.any(String) })
    )
    expect(rest.get).toHaveBeenCalledWith(
      expect.stringContaining(`/channels/c1/messages?limit=5`)
    )
    expect(postWake).toHaveBeenCalledTimes(1)
    expect(postWake.mock.calls[0][0]).toMatchObject({
      entityType: `discord-bot`,
      entityId: `new-thread`,
      message: { kind: `mention`, threadId: `new-thread`, channelId: `c1` },
    })
  })

  it(`forwards thread_msg straight through`, async () => {
    const rest = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const postWake = vi.fn().mockResolvedValue(undefined)
    await processGatewayEvent(
      {
        kind: `thread_msg`,
        threadId: `t1`,
        userId: `u`,
        content: `hi`,
        idempotencyKey: `m`,
      },
      { rest: rest as any, postWake, primeMessageLimit: 20 }
    )
    expect(rest.post).not.toHaveBeenCalled()
    expect(postWake.mock.calls[0][0]).toMatchObject({
      entityId: `t1`,
      message: { kind: `thread_msg`, threadId: `t1` },
    })
  })
})
