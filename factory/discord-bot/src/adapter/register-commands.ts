// src/adapter/register-commands.ts
import { createDiscordRest } from '../discord-rest'
import { loadConfig } from '../config'

async function main(): Promise<void> {
  try {
    ;(process as any).loadEnvFile?.()
  } catch {}
  const cfg = loadConfig()
  const rest = createDiscordRest({ token: cfg.discord.botToken })
  const commands = [
    {
      name: `end`,
      description: `End this Discord bot session.`,
    },
  ]
  const path = cfg.discord.guildId
    ? `/applications/${cfg.discord.appId}/guilds/${cfg.discord.guildId}/commands`
    : `/applications/${cfg.discord.appId}/commands`
  await rest.put(path, commands)
  console.log(`Registered ${commands.length} command(s) at ${path}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
