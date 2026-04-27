import type { AgentConfig } from '@electric-ax/agents-runtime'

const SONNET_MODEL = `claude-sonnet-4-5-20250929`
const KIMI_MODEL = `kimi-k2.6`
const KIMI_BASE_URL = `https://api.moonshot.ai/v1`

type AgentModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `getApiKey` | `onPayload`
>

function hasEnv(name: string): boolean {
  return (process.env[name]?.trim().length ?? 0) > 0
}

function sonnetConfig(): AgentModelConfig {
  return {
    provider: `anthropic`,
    model: SONNET_MODEL,
  }
}

function kimiConfig(): AgentModelConfig {
  const apiKey = process.env.MOONSHOT_API_KEY?.trim()
  if (!apiKey) {
    throw new Error(`MOONSHOT_API_KEY must be set to use ${KIMI_MODEL}`)
  }

  return {
    model: {
      id: KIMI_MODEL,
      name: `Kimi K2.6`,
      api: `openai-completions`,
      provider: `moonshot`,
      baseUrl: KIMI_BASE_URL,
      reasoning: true,
      input: [`text`],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: `max_tokens`,
      },
    },
    getApiKey: (provider) => (provider === `moonshot` ? apiKey : undefined),
    onPayload: (payload, model) => {
      if (model.provider !== `moonshot` || typeof payload !== `object`) {
        return undefined
      }

      return {
        ...payload,
        thinking: { type: `enabled` },
      }
    },
  }
}

function assertModelEnv(): void {
  if (!hasEnv(`ANTHROPIC_API_KEY`) && !hasEnv(`MOONSHOT_API_KEY`)) {
    throw new Error(
      `Set ANTHROPIC_API_KEY or MOONSHOT_API_KEY before running Deep Survey`
    )
  }
}

export function orchestratorModelConfig(): AgentModelConfig {
  assertModelEnv()
  return hasEnv(`ANTHROPIC_API_KEY`) ? sonnetConfig() : kimiConfig()
}

export function surveyWorkerModelConfig(): AgentModelConfig {
  assertModelEnv()
  return hasEnv(`MOONSHOT_API_KEY`) ? kimiConfig() : sonnetConfig()
}
