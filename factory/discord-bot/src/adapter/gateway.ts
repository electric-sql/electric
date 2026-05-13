import { Client, GatewayIntentBits } from 'discord.js'
import { mapMessageCreate, type GatewayMapOutput } from './gateway-mapper'

export interface GatewayConfig {
  token: string
  botUserId: string
  onEvent: (event: NonNullable<GatewayMapOutput>) => void | Promise<void>
  createClient?: () => unknown
}

export async function startGatewayClient(
  cfg: GatewayConfig
): Promise<{ stop: () => Promise<void> }> {
  const client =
    (cfg.createClient?.() as Client) ??
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
    })

  ;(client as unknown as { on: Function }).on(
    `messageCreate`,
    async (raw: any) => {
      let channelIsThread = false
      try {
        const channel = await (client as any).channels.fetch(
          raw.channel_id ?? raw.channelId
        )
        channelIsThread =
          typeof channel?.isThread === `function` ? channel.isThread() : false
      } catch {
        channelIsThread = false
      }
      const mapped = mapMessageCreate({
        botUserId: cfg.botUserId,
        message: {
          id: raw.id,
          channel_id: raw.channel_id ?? raw.channelId,
          author: {
            id: raw.author.id,
            username: raw.author.username,
            bot: raw.author.bot,
          },
          content: raw.content,
          mentions: (raw.mentions ?? []).map((m: any) => ({ id: m.id ?? m })),
          referenced_message: raw.referenced_message ?? null,
          thread: null,
          attachments: raw.attachments ?? [],
        },
        channelIsThread,
      })
      if (mapped) await cfg.onEvent(mapped)
    }
  )

  if (typeof (client as any).login === `function` && cfg.token) {
    await (client as any).login(cfg.token)
  }

  return {
    async stop() {
      if (typeof (client as any).destroy === `function`)
        await (client as any).destroy()
    },
  }
}
