import type { Model } from '@earendil-works/pi-ai/compat'

export const MOONSHOT_PROVIDER = `moonshot` as const
export type MoonshotProvider = typeof MOONSHOT_PROVIDER

export const MOONSHOT_API_KEY_ENV = `MOONSHOT_API_KEY`
export const MOONSHOT_API_BASE_URL = `https://api.moonshot.ai/v1`

export type MoonshotModel = Model<`openai-completions`> & {
  provider: MoonshotProvider
}

const MOONSHOT_OPENAI_COMPAT: MoonshotModel[`compat`] = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: `max_completion_tokens`,
}

const MOONSHOT_MODELS: Array<MoonshotModel> = [
  {
    id: `kimi-k2.6`,
    name: `Kimi K2.6`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: true,
    input: [`text`, `image`],
    cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 32_768,
  },
  {
    id: `kimi-k2.5`,
    name: `Kimi K2.5`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: true,
    input: [`text`, `image`],
    cost: { input: 0.6, output: 3, cacheRead: 0.08, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 32_768,
  },
  {
    id: `moonshot-v1-8k`,
    name: `Moonshot V1 8K`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 8_192,
  },
  {
    id: `moonshot-v1-32k`,
    name: `Moonshot V1 32K`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 32_768,
  },
  {
    id: `moonshot-v1-128k`,
    name: `Moonshot V1 128K`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 131_072,
  },
  {
    id: `moonshot-v1-8k-vision-preview`,
    name: `Moonshot V1 8K Vision Preview`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`, `image`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_192,
    maxTokens: 8_192,
  },
  {
    id: `moonshot-v1-32k-vision-preview`,
    name: `Moonshot V1 32K Vision Preview`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`, `image`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 32_768,
  },
  {
    id: `moonshot-v1-128k-vision-preview`,
    name: `Moonshot V1 128K Vision Preview`,
    api: `openai-completions`,
    provider: MOONSHOT_PROVIDER,
    baseUrl: MOONSHOT_API_BASE_URL,
    compat: MOONSHOT_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`, `image`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: 131_072,
  },
]

const MOONSHOT_MODELS_BY_ID = new Map(
  MOONSHOT_MODELS.map((model) => [model.id, model])
)

export function getMoonshotModels(): Array<MoonshotModel> {
  return MOONSHOT_MODELS.slice()
}

export function getMoonshotModel(id: string): MoonshotModel | undefined {
  return MOONSHOT_MODELS_BY_ID.get(id)
}

export function getMoonshotApiKey(): string | undefined {
  return process.env[MOONSHOT_API_KEY_ENV]?.trim() || undefined
}
