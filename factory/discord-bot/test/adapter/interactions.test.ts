import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { handleInteraction } from '../../src/adapter/interactions'

function signedRequest(
  privateKey: any,
  body: string
): { timestamp: string; signature: string } {
  const timestamp = `${Date.now()}`
  const signature = sign(
    null,
    Buffer.from(timestamp + body),
    privateKey
  ).toString(`hex`)
  return { timestamp, signature }
}

describe(`handleInteraction`, () => {
  const { publicKey, privateKey } = generateKeyPairSync(`ed25519`)
  const publicKeyHex = (
    publicKey.export({ format: `der`, type: `spki` }) as Buffer
  )
    .subarray(-32)
    .toString(`hex`)

  it(`401s on bad signature`, async () => {
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body: `{}`,
      timestamp: `1`,
      signature: `00`.repeat(64),
      onEvent,
    })
    expect(result.status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it(`responds to PING with PONG`, async () => {
    const body = JSON.stringify({ type: 1 })
    const { timestamp, signature } = signedRequest(privateKey, body)
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body,
      timestamp,
      signature,
      onEvent,
    })
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body!)).toEqual({ type: 1 })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it(`dispatches a slash command to onEvent`, async () => {
    const body = JSON.stringify({
      type: 2,
      id: `i1`,
      channel_id: `t1`,
      member: { user: { id: `u1` } },
      data: { name: `end`, options: [] },
    })
    const { timestamp, signature } = signedRequest(privateKey, body)
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body,
      timestamp,
      signature,
      onEvent,
    })
    expect(result.status).toBe(200)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      kind: `interaction`,
      threadId: `t1`,
      userId: `u1`,
      command: `/end`,
    })
  })
})
