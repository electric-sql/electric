import { createPublicKey, verify } from 'node:crypto'
import type { DiscordWakeMessage } from '../wake-message'

export interface InteractionInput {
  publicKeyHex: string
  body: string
  timestamp: string
  signature: string
  onEvent: (event: DiscordWakeMessage) => void | Promise<void>
}

export interface InteractionResult {
  status: number
  body?: string
  headers?: Record<string, string>
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, `hex`)
}

function spkiFromRawPublicKey(raw: Buffer): Buffer {
  // Ed25519 SPKI prefix (fixed 12-byte ASN.1 header for Ed25519 keys)
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ])
  return Buffer.concat([prefix, raw])
}

export async function handleInteraction(
  input: InteractionInput
): Promise<InteractionResult> {
  try {
    const pubRaw = hexToBuffer(input.publicKeyHex)
    const key = createPublicKey({
      key: spkiFromRawPublicKey(pubRaw),
      format: `der`,
      type: `spki`,
    })
    const valid = verify(
      null,
      Buffer.from(input.timestamp + input.body),
      key,
      hexToBuffer(input.signature)
    )
    if (!valid) return { status: 401, body: `invalid signature` }
  } catch {
    return { status: 401, body: `invalid signature` }
  }

  const payload = JSON.parse(input.body) as {
    type: number
    id?: string
    channel_id?: string
    member?: { user?: { id: string } }
    user?: { id: string }
    data?: {
      name?: string
      options?: Array<{ name: string; value: string | number | boolean }>
    }
  }

  // PING
  if (payload.type === 1) {
    return {
      status: 200,
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify({ type: 1 }),
    }
  }

  // APPLICATION_COMMAND (slash command)
  if (payload.type === 2) {
    const command = `/${payload.data?.name ?? ``}`
    const userId = payload.member?.user?.id ?? payload.user?.id ?? `unknown`
    const threadId = payload.channel_id ?? ``
    const options: Record<string, string | number | boolean> = {}
    for (const opt of payload.data?.options ?? []) options[opt.name] = opt.value
    await input.onEvent({
      kind: `interaction`,
      threadId,
      userId,
      command,
      options,
      idempotencyKey: payload.id,
    })
    // Acknowledge with a deferred response so the entity can post via REST.
    return {
      status: 200,
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify({ type: 5 }),
    }
  }

  return { status: 200, body: `{}` }
}
