# `@electric-ax/discord-bot`

Discord adapter + per-thread `discord-bot` entity for Electric Agents.

See the design spec: `docs/superpowers/specs/2026-05-13-discord-bot-design.md`.

## What it does

- `@bot <question>` in a Discord channel opens a thread and answers — using GitHub MCP, Electric Agents docs, and web search.
- `@bot fix issue #N` opens a thread and hands the task to a Horton coding agent running in a separate runtime host; the bot reports back with the PR when Horton finishes.
- Asks clarifying questions in-thread when a task is under-specified.
- Extensible via `extraTools`, `extraMcpServers`, and `skills` at register time.

## Architecture

Two layers in this package:

- **Adapter (Node process):** holds the Discord Gateway WebSocket + an HTTP Interactions endpoint, translates Discord events into webhook POSTs to your `agents-server`.
- **Entity:** registered into your existing `agents-server` registry via `registerDiscordBot(registry, opts)`. One instance per Discord thread. Tools use raw `fetch` (no Node-only APIs) so a future Cloudflare DO host can reuse the entity unchanged.

## Discord application setup

1. https://discord.com/developers/applications → New Application.
2. Bot tab → Add Bot → reveal Token (`DISCORD_BOT_TOKEN`).
3. Enable Privileged Gateway Intents → `MESSAGE CONTENT INTENT`.
4. OAuth2 → URL Generator → scopes `bot`, `applications.commands` → bot permissions: Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Add Reactions. Use the generated URL to invite to your guild.
5. General Information → copy `Public Key` (`DISCORD_PUBLIC_KEY`) and `Application ID` (`DISCORD_APP_ID`).
6. General Information → Interactions Endpoint URL → set to `https://<your-public-host>/interactions` (Discord verifies this at save time, so deploy first or use a tunnel).

## Configuration

Environment variables (alternatively pass an options object to `registerDiscordBot`):

```
DISCORD_BOT_TOKEN              gateway login + REST calls
DISCORD_PUBLIC_KEY             Ed25519 verification key
DISCORD_APP_ID
DISCORD_GUILD_ID               optional, scope bot to one guild

AGENTS_SERVER_URL              wake webhook target
AGENTS_SERVER_TOKEN            shared secret for webhook auth

HORTON_AGENTS_SERVER_URL       defaults to AGENTS_SERVER_URL
HORTON_ENTITY_TYPE             default 'horton'

GITHUB_TOKEN
GITHUB_REPO                    owner/name (v1: single repo)

DISCORD_ADAPTER_PORT           default 4449
DISCORD_PRIME_MESSAGE_LIMIT    default 20

ANTHROPIC_API_KEY | OPENAI_API_KEY
```

GitHub MCP is configured via your existing `agents-server` `mcp.json` or `extraMcpServers`; the bot consumes whatever MCP tools the runtime exposes.

## Register the entity in your agents-server

Add to your agents-server bootstrap, next to `registerHorton` / `registerWorker`:

```ts
import { registerDiscordBot } from '@electric-ax/discord-bot'

registerDiscordBot(registry, {
  appId: process.env.DISCORD_APP_ID!,
  botToken: process.env.DISCORD_BOT_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID,
  github: { repo: process.env.GITHUB_REPO!, token: process.env.GITHUB_TOKEN! },
  hortonRuntime: {
    agentsServerUrl:
      process.env.HORTON_AGENTS_SERVER_URL ?? process.env.AGENTS_SERVER_URL!,
    entityType: process.env.HORTON_ENTITY_TYPE ?? 'horton',
  },
  modelCatalog, // same catalog you use for Horton
  primeContext: { messageLimit: 20 },
  // extraTools: [...], extraMcpServers: [...], skills: ...,
})
```

## Run the adapter

```sh
# Register slash commands once (per guild or globally)
pnpm --filter @electric-ax/discord-bot exec discord-bot-register

# Start the adapter (Gateway + Interactions)
pnpm --filter @electric-ax/discord-bot exec discord-bot
```

The adapter and your `agents-server` are separate processes; you typically run them side-by-side on the same machine. Point your Discord application's Interactions Endpoint URL at `https://<public-host>/interactions` — terminate TLS in front of the adapter (nginx, Caddy, Cloudflare Tunnel, …).

## Extension points

- `extraTools`: any `AgentTool` shape from `@mariozechner/pi-agent-core`; the entity exposes them alongside `discord.*` and `spawn_horton`.
- `extraMcpServers`: passed to the agents-server's MCP registry; the bot automatically picks up the bridged tools.
- `skills`: a `SkillsRegistry` (same shape Horton uses); the bot gains `use_skill` / `remove_skill` and the skills catalog.

## Troubleshooting

- **Gateway connects then disconnects with code 4014.** Privileged Intents not enabled on the application — re-check step 3 above.
- **Interactions endpoint URL rejected at save time.** Your endpoint must be reachable over HTTPS _before_ you click Save in the Developer Portal; deploy first, then save.
- **Signature checks fail.** `DISCORD_PUBLIC_KEY` must be the hex string from the Developer Portal (no `0x` prefix, no whitespace).
- **Bot replies in the wrong place.** The adapter assumes `entityId = threadId`. If your `agents-server` routes by something else, the wake will be dropped — confirm webhook handling.
- **GitHub MCP tools missing.** GH MCP is _not_ bundled here; it must be configured in your `agents-server` (`mcp.json` or `extraMcpServers`). The bot looks up MCP tools from the runtime tool-provider registry.

## Future deploys

A full Cloudflare Durable Object deploy (Gateway via WebSocket Hibernation API + Interactions + in-DO entity host) is on the roadmap — see §10 of the spec. The v1 entity is already constrained to runtime-portable APIs so it can drop into a DO host without rewrites.
