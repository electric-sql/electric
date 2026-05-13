import type {
  AgentTool,
  EntityRegistry,
  HandlerContext,
  RuntimeServerClient,
} from '@electric-ax/agents-runtime'
import { createDiscordRest } from './discord-rest'
import { createDiscordTools } from './tools/discord'
import { createSpawnHortonTool } from './tools/delegate'
import { buildDiscordBotSystemPrompt } from './system-prompt'
import { buildPrimeContextEntries } from './prime-context'
import { discordWakeMessageSchema } from './wake-message'

export interface DiscordBotOptions {
  appId: string
  botToken: string
  guildId?: string
  github: { repo: string; token: string }
  hortonRuntime: { agentsServerUrl: string; entityType: string }
  primeContext?: { messageLimit: number }
  extraTools?: ReadonlyArray<AgentTool>
  // McpServerConfig type lives in @electric-ax/agents-mcp; keep as unknown[]
  // to avoid pulling that package in for v1 unless already a transitive dep
  extraMcpServers?: ReadonlyArray<unknown>
  modelCatalog: unknown
  hasDocsSearch?: boolean
}

/**
 * Extract a minimal model config from the operator-supplied model catalog.
 * The catalog shape is `{ primary: { provider, model, apiKey } }` but may vary;
 * fall back to a safe Anthropic default so the entity always compiles.
 */
function extractModelConfig(catalog: unknown): {
  model: string
  provider?: string
  getApiKey?: (provider: string) => string | undefined
} {
  if (catalog != null && typeof catalog === `object` && `primary` in catalog) {
    const primary = (catalog as Record<string, unknown>).primary
    if (primary != null && typeof primary === `object`) {
      const p = primary as Record<string, unknown>
      const model = typeof p.model === `string` ? p.model : `claude-sonnet-4-6`
      const provider = typeof p.provider === `string` ? p.provider : undefined
      const apiKey = typeof p.apiKey === `string` ? p.apiKey : undefined
      return {
        model,
        provider,
        ...(apiKey ? { getApiKey: () => apiKey } : {}),
      }
    }
  }
  return { model: `claude-sonnet-4-6`, provider: `anthropic` }
}

export function registerDiscordBot(
  registry: EntityRegistry,
  opts: DiscordBotOptions
): void {
  const rest = createDiscordRest({ token: opts.botToken })
  const systemPrompt = buildDiscordBotSystemPrompt({
    githubRepo: opts.github.repo,
    hasDocsSearch: opts.hasDocsSearch,
  })
  const modelConfig = extractModelConfig(opts.modelCatalog)

  registry.define(`discord-bot`, {
    description: `Discord-facing conversational agent. One instance per Discord thread.`,
    async handler(ctx: HandlerContext) {
      const threadId = String(
        (ctx.args as { threadId?: string }).threadId ?? ``
      )

      // Apply priming from a 'mention' wake event that carries primeMessages.
      for (const event of ctx.events) {
        const msg = (event as { payload?: unknown }).payload
        const parsed = discordWakeMessageSchema.safeParse(msg)
        if (!parsed.success) continue

        if (
          parsed.data.kind === `mention` &&
          parsed.data.primeMessages?.length
        ) {
          const entries = buildPrimeContextEntries({
            channelId: parsed.data.channelId,
            threadId: parsed.data.threadId,
            messages: parsed.data.primeMessages,
          })
          for (const e of entries) {
            ctx.insertContext(e.key, {
              name: e.key,
              content: e.text,
              attrs: e.attrs,
            })
          }
        }

        if (parsed.data.kind === `thread_close`) {
          ctx.insertContext(`discord-close-${parsed.data.threadId}`, {
            name: `discord-close-${parsed.data.threadId}`,
            content: `Thread closed. End the session politely.`,
            attrs: { role: `system`, source: `discord-lifecycle` } as any,
          })
        }
      }

      const tools: Array<AgentTool> = [
        ...createDiscordTools({ rest }),
        createSpawnHortonTool({
          runtime: (
            ctx as unknown as { runtimeServerClient: RuntimeServerClient }
          ).runtimeServerClient,
          hortonEntityType: opts.hortonRuntime.entityType,
          threadId,
          defaultRepo: opts.github.repo,
          parentUrl: ctx.entityUrl,
        }),
        ...(opts.extraTools ?? []),
      ]

      // Cast is needed because `provider` extracted from unknown catalog is
      // `string` but AgentConfig expects the narrower `KnownProvider` type.
      ctx.useAgent({
        systemPrompt,
        tools,
        ...modelConfig,
      } as Parameters<typeof ctx.useAgent>[0])
      await ctx.agent.run()
    },
  })
}
