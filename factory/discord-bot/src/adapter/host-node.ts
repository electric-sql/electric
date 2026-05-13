import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { createDiscordRest, type DiscordRest } from '../discord-rest'
import { loadConfig } from '../config'
import { startGatewayClient } from './gateway'
import { handleInteraction } from './interactions'
import { ensureThreadForMention } from './thread'
import {
  createWakeWebhookPoster,
  type WakeWebhookPoster,
  type WakeWebhookPayload,
} from './webhook'
import type { GatewayMapOutput } from './gateway-mapper'

export interface ProcessGatewayDeps {
  rest: DiscordRest
  postWake: WakeWebhookPoster
  primeMessageLimit: number
}

export async function processGatewayEvent(
  event: NonNullable<GatewayMapOutput>,
  deps: ProcessGatewayDeps
): Promise<void> {
  if (event.kind === `thread_msg`) {
    await deps.postWake({
      entityType: `discord-bot`,
      entityId: event.threadId,
      message: event,
    })
    return
  }

  // pre_thread_mention: create thread + fetch priming messages + post wake
  const threadId = await ensureThreadForMention({
    rest: deps.rest,
    message: {
      id: event.messageId,
      channel_id: event.channelId,
      channel_is_thread: false,
      threadName: event.content.slice(0, 50) || `Electric bot`,
    },
  })

  const primeRaw = (await deps.rest.get(
    `/channels/${event.channelId}/messages?limit=${deps.primeMessageLimit}`
  )) as Array<{
    id: string
    author: { username: string }
    content: string
    timestamp: string
  }>
  const primeMessages = primeRaw.map((m) => ({
    id: m.id,
    author: m.author.username,
    content: m.content,
    timestamp: new Date(m.timestamp).getTime(),
  }))

  const payload: WakeWebhookPayload = {
    entityType: `discord-bot`,
    entityId: threadId,
    message: {
      kind: `mention`,
      threadId,
      channelId: event.channelId,
      userId: event.userId,
      content: event.content,
      referencedMessageId: event.referencedMessageId,
      primeMessages,
      idempotencyKey: event.messageId,
    },
  }
  await deps.postWake(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on(`data`, (c) => chunks.push(c as Buffer))
    req.on(`end`, () => resolve(Buffer.concat(chunks).toString(`utf8`)))
    req.on(`error`, reject)
  })
}

export async function main(): Promise<void> {
  try {
    ;(process as any).loadEnvFile?.()
  } catch {}
  const cfg = loadConfig()
  const rest = createDiscordRest({ token: cfg.discord.botToken })
  const postWake = createWakeWebhookPoster({
    agentsServerUrl: cfg.agentsServer.url,
    agentsServerToken: cfg.agentsServer.token,
  })

  const { stop } = await startGatewayClient({
    token: cfg.discord.botToken,
    botUserId: cfg.discord.appId,
    onEvent: (event) =>
      processGatewayEvent(event as NonNullable<GatewayMapOutput>, {
        rest,
        postWake,
        primeMessageLimit: cfg.primeContext.messageLimit,
      }),
  })

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== `POST` || req.url !== `/interactions`) {
        res.writeHead(404).end()
        return
      }
      const body = await readBody(req)
      const result = await handleInteraction({
        publicKeyHex: cfg.discord.publicKey,
        body,
        timestamp: String(req.headers[`x-signature-timestamp`] ?? ``),
        signature: String(req.headers[`x-signature-ed25519`] ?? ``),
        onEvent: (event) =>
          postWake({
            entityType: `discord-bot`,
            entityId: event.threadId,
            message: event,
          }),
      })
      res.writeHead(result.status, result.headers ?? {})
      res.end(result.body ?? ``)
    }
  )
  server.listen(cfg.adapter.port, () => {
    console.log(`discord-bot adapter listening on :${cfg.adapter.port}`)
  })

  const onSignal = async () => {
    await stop()
    server.close()
    process.exit(0)
  }
  process.on(`SIGINT`, onSignal)
  process.on(`SIGTERM`, onSignal)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
