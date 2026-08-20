import type { Model } from '@mariozechner/pi-ai'

export const ORCAROUTER_PROVIDER = `orcarouter` as const
export type OrcaRouterProvider = typeof ORCAROUTER_PROVIDER

export const ORCAROUTER_API_KEY_ENV = `ORCAROUTER_API_KEY`
export const ORCAROUTER_API_BASE_URL = `https://api.orcarouter.ai/v1`

export type OrcaRouterModel = Model<`openai-completions`> & {
  provider: OrcaRouterProvider
}

const ORCAROUTER_OPENAI_COMPAT: OrcaRouterModel[`compat`] = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  maxTokensField: `max_completion_tokens`,
}

const ORCAROUTER_MODELS: Array<OrcaRouterModel> = [
  {
    id: `orcarouter/auto`,
    name: `Auto (smart routing)`,
    api: `openai-completions`,
    provider: ORCAROUTER_PROVIDER,
    baseUrl: ORCAROUTER_API_BASE_URL,
    compat: ORCAROUTER_OPENAI_COMPAT,
    reasoning: true,
    input: [`text`, `image`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 262_144,
    maxTokens: 32_768,
  },
  {
    id: `orcarouter/fusion`,
    name: `Fusion`,
    api: `openai-completions`,
    provider: ORCAROUTER_PROVIDER,
    baseUrl: ORCAROUTER_API_BASE_URL,
    compat: ORCAROUTER_OPENAI_COMPAT,
    reasoning: true,
    input: [`text`, `image`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: `orcarouter/fusion-flash`,
    name: `Fusion Flash`,
    api: `openai-completions`,
    provider: ORCAROUTER_PROVIDER,
    baseUrl: ORCAROUTER_API_BASE_URL,
    compat: ORCAROUTER_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 32_768,
  },
  {
    id: `orcarouter/fusion-mini`,
    name: `Fusion Mini`,
    api: `openai-completions`,
    provider: ORCAROUTER_PROVIDER,
    baseUrl: ORCAROUTER_API_BASE_URL,
    compat: ORCAROUTER_OPENAI_COMPAT,
    reasoning: false,
    input: [`text`],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
]

const ORCAROUTER_MODELS_BY_ID = new Map(
  ORCAROUTER_MODELS.map((model) => [model.id, model])
)

export function getOrcaRouterModels(): Array<OrcaRouterModel> {
  return ORCAROUTER_MODELS.slice()
}

export function getOrcaRouterModel(id: string): OrcaRouterModel | undefined {
  return ORCAROUTER_MODELS_BY_ID.get(id)
}

export function getOrcaRouterApiKey(): string | undefined {
  return process.env[ORCAROUTER_API_KEY_ENV]?.trim() || undefined
}
