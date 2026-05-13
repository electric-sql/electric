import { z } from 'zod'

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  AGENTS_SERVER_URL: z.string().url(),
  AGENTS_SERVER_TOKEN: z.string().min(1),
  HORTON_AGENTS_SERVER_URL: z.string().url().optional(),
  HORTON_ENTITY_TYPE: z.string().default(`horton`),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_REPO: z.string().regex(/^[^/]+\/[^/]+$/),
  DISCORD_ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(4449),
  DISCORD_PRIME_MESSAGE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20),
})

export type DiscordBotConfig = ReturnType<typeof loadConfig>

export function loadConfig(
  env: Record<string, string | undefined> = process.env
): {
  discord: {
    botToken: string
    publicKey: string
    appId: string
    guildId?: string
  }
  agentsServer: { url: string; token: string }
  horton: { agentsServerUrl: string; entityType: string }
  github: { repo: string; token: string }
  adapter: { port: number }
  primeContext: { messageLimit: number }
} {
  const parsed = envSchema.parse(env)
  return {
    discord: {
      botToken: parsed.DISCORD_BOT_TOKEN,
      publicKey: parsed.DISCORD_PUBLIC_KEY,
      appId: parsed.DISCORD_APP_ID,
      guildId: parsed.DISCORD_GUILD_ID,
    },
    agentsServer: {
      url: parsed.AGENTS_SERVER_URL,
      token: parsed.AGENTS_SERVER_TOKEN,
    },
    horton: {
      agentsServerUrl:
        parsed.HORTON_AGENTS_SERVER_URL ?? parsed.AGENTS_SERVER_URL,
      entityType: parsed.HORTON_ENTITY_TYPE,
    },
    github: { repo: parsed.GITHUB_REPO, token: parsed.GITHUB_TOKEN },
    adapter: { port: parsed.DISCORD_ADAPTER_PORT },
    primeContext: { messageLimit: parsed.DISCORD_PRIME_MESSAGE_LIMIT },
  }
}
