import { getModels } from '@mariozechner/pi-ai'
import {
  MOONSHOT_API_BASE_URL,
  MOONSHOT_PROVIDER,
  detectAvailableProviders,
  getMoonshotApiKey,
  getMoonshotModels,
  readCodexAccessToken,
} from '@electric-ax/agents-runtime'
import type {
  AgentConfig,
  AvailableProvider,
} from '@electric-ax/agents-runtime'

export type BuiltinModelProvider = AvailableProvider
export type BuiltinModelInput = `text` | `image`

export const MODEL_INPUTS_SCHEMA_DEF = `electricModelInputs`

export interface BuiltinModelChoice {
  provider: BuiltinModelProvider
  id: string
  label: string
  value: string
  reasoning: boolean
  input: Array<BuiltinModelInput>
}

export interface BuiltinModelCatalog {
  choices: Array<BuiltinModelChoice>
  defaultChoice: BuiltinModelChoice
}

export interface BuiltinModelCatalogOptions {
  allowMockFallback?: boolean
  enabledModelValues?: ReadonlyArray<string> | null
}

export const REASONING_EFFORT_VALUES = [
  `auto`,
  `minimal`,
  `low`,
  `medium`,
  `high`,
] as const

export type BuiltinReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]
type ExplicitReasoningEffort = Exclude<BuiltinReasoningEffort, `auto`>

export type BuiltinAgentModelConfig = Pick<
  AgentConfig,
  `model` | `provider` | `onPayload` | `getApiKey`
> & {
  reasoningEffort?: ExplicitReasoningEffort
}

type PersistedModelConfig = Pick<AgentConfig, `model` | `provider`> & {
  reasoningEffort?: ExplicitReasoningEffort
}

const DEFAULT_ANTHROPIC_MODEL = `claude-sonnet-4-6`
const DEFAULT_OPENAI_MODEL = `gpt-4.1`
const DEFAULT_CODEX_MODEL = `gpt-5.4`
const DEFAULT_DEEPSEEK_MODEL = `deepseek-v4-flash`
const DEFAULT_MOONSHOT_MODEL = `kimi-k2.6`

function modelValue(provider: BuiltinModelProvider, id: string): string {
  return `${provider}:${id}`
}

export function builtinModelProviderLabel(
  provider: BuiltinModelProvider
): string {
  if (provider === `anthropic`) return `Anthropic`
  if (provider === `openai-codex`) return `OpenAI Codex`
  if (provider === `deepseek`) return `DeepSeek`
  if (provider === MOONSHOT_PROVIDER) return `Kimi`
  return `OpenAI`
}

function configuredProviders(): Array<BuiltinModelProvider> {
  return detectAvailableProviders()
}

function mockFallbackCatalog(): BuiltinModelCatalog {
  const fallback: BuiltinModelChoice = {
    provider: `anthropic` as const,
    id: DEFAULT_ANTHROPIC_MODEL,
    label: `Anthropic ${DEFAULT_ANTHROPIC_MODEL}`,
    value: modelValue(`anthropic`, DEFAULT_ANTHROPIC_MODEL),
    reasoning: true,
    input: [`text`, `image`],
  }
  return { choices: [fallback], defaultChoice: fallback }
}

async function fetchAvailableModelIds(
  provider: BuiltinModelProvider
): Promise<Set<string> | null> {
  try {
    const res =
      provider === `anthropic`
        ? await fetch(`https://api.anthropic.com/v1/models`, {
            headers: {
              'x-api-key': process.env.ANTHROPIC_API_KEY ?? ``,
              'anthropic-version': `2023-06-01`,
            },
            signal: AbortSignal.timeout(3_000),
          })
        : provider === `deepseek`
          ? await fetch(`https://api.deepseek.com/v1/models`, {
              headers: {
                authorization: `Bearer ${process.env.DEEPSEEK_API_KEY ?? ``}`,
              },
              signal: AbortSignal.timeout(3_000),
            })
          : provider === MOONSHOT_PROVIDER
            ? await fetch(`${MOONSHOT_API_BASE_URL}/models`, {
                headers: {
                  authorization: `Bearer ${getMoonshotApiKey() ?? ``}`,
                },
                signal: AbortSignal.timeout(3_000),
              })
            : await fetch(`https://api.openai.com/v1/models`, {
                headers: {
                  authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ``}`,
                },
                signal: AbortSignal.timeout(3_000),
              })

    if (res.status === 401 || res.status === 403) return new Set()
    if (!res.ok) return null

    const body = (await res.json()) as { data?: Array<{ id?: unknown }> }
    const ids = new Set(
      (body.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => typeof id === `string`)
    )

    return ids.size > 0 ? ids : null
  } catch {
    return null
  }
}

function knownModelsForProvider(provider: BuiltinModelProvider) {
  return provider === MOONSHOT_PROVIDER
    ? getMoonshotModels()
    : getModels(
        provider as Exclude<BuiltinModelProvider, typeof MOONSHOT_PROVIDER>
      )
}

function choiceForKnownModel(
  provider: BuiltinModelProvider,
  model: ReturnType<typeof knownModelsForProvider>[number]
): BuiltinModelChoice {
  return {
    provider,
    id: model.id,
    label: `${builtinModelProviderLabel(provider)} ${model.name}`,
    value: modelValue(provider, model.id),
    reasoning: model.reasoning,
    input: model.input,
  }
}

export function listBuiltinModelChoices(
  providers: ReadonlyArray<BuiltinModelProvider>
): Array<BuiltinModelChoice> {
  return providers.flatMap((provider) =>
    knownModelsForProvider(provider).map((model) =>
      choiceForKnownModel(provider, model)
    )
  )
}

async function choicesForProvider(
  provider: BuiltinModelProvider
): Promise<Array<BuiltinModelChoice>> {
  const knownChoices = listBuiltinModelChoices([provider])

  if (provider === `openai-codex`) {
    return knownChoices
  }

  const availableIds = await fetchAvailableModelIds(provider)
  return availableIds === null
    ? knownChoices
    : knownChoices.filter((choice) => availableIds.has(choice.id))
}

function enabledModelSet(
  values: ReadonlyArray<string> | null | undefined
): Set<string> | null {
  if (!values) return null
  const enabled = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed) enabled.add(trimmed)
  }
  return enabled.size > 0 ? enabled : null
}

function filterChoicesByEnabledModels(
  choices: Array<BuiltinModelChoice>,
  values: ReadonlyArray<string> | null | undefined
): Array<BuiltinModelChoice> {
  const enabled = enabledModelSet(values)
  if (!enabled) return choices
  const filtered = choices.filter((choice) => enabled.has(choice.value))
  return filtered.length > 0 ? filtered : choices
}

/**
 * Anthropic-specific budget mapping for `reasoningEffort`.
 *
 * Anthropic's `thinking.budget_tokens` is a hard cap on tokens spent
 * inside the thinking block before the model must commit to its
 * answer. Docs require ≥ 1024; we scale from there. Numbers tuned so
 * `medium` is the spot most "show your work" requests land, and
 * `high` covers tougher reasoning without uncapped spend.
 *
 * Keep in sync with provider doc updates — Anthropic has shifted the
 * minimum once already (older models capped lower).
 */
const ANTHROPIC_THINKING_BUDGET_BY_EFFORT: Record<
  ExplicitReasoningEffort,
  number
> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 24576,
}

function withProviderPayloadDefaults(
  config: PersistedModelConfig & { getApiKey?: AgentConfig[`getApiKey`] },
  choice: BuiltinModelChoice,
  reasoningEffort: ExplicitReasoningEffort | null
): BuiltinAgentModelConfig {
  if (!choice.reasoning) return config

  if (choice.provider === `openai` || choice.provider === `openai-codex`) {
    const defaultEffort = choice.provider === `openai-codex` ? `low` : `minimal`
    const effort =
      reasoningEffort === `minimal` && choice.provider === `openai-codex`
        ? `low`
        : (reasoningEffort ?? defaultEffort)

    return {
      ...config,
      onPayload: (payload) => {
        if (typeof payload !== `object` || payload === null) return undefined
        const body = payload as Record<string, unknown>
        const existingReasoning =
          typeof body.reasoning === `object` && body.reasoning !== null
            ? (body.reasoning as Record<string, unknown>)
            : {}

        return {
          ...body,
          reasoning: {
            ...existingReasoning,
            effort,
          },
        }
      },
    }
  }

  if (choice.provider === `anthropic`) {
    // `auto` maps to the minimal budget so extended thinking is always
    // on for reasoning-capable Anthropic models, matching the OpenAI
    // branch above (where `auto` falls through to a `minimal` default).
    const effectiveEffort = reasoningEffort ?? `minimal`
    const budgetTokens = ANTHROPIC_THINKING_BUDGET_BY_EFFORT[effectiveEffort]

    return {
      ...config,
      onPayload: (payload) => {
        if (typeof payload !== `object` || payload === null) return undefined
        const body = payload as Record<string, unknown>
        // pi-ai writes `thinking: { type: "disabled" }` into the payload
        // by default. Merge our enabled-thinking values last so they win
        // — otherwise the API rejects `budget_tokens` for a disabled
        // `thinking` block.
        const existingThinking =
          typeof body.thinking === `object` && body.thinking !== null
            ? (body.thinking as Record<string, unknown>)
            : {}
        return {
          ...body,
          thinking: {
            ...existingThinking,
            type: `enabled`,
            budget_tokens: budgetTokens,
          },
        }
      },
    }
  }

  return config
}

function parseReasoningEffort(value: unknown): ExplicitReasoningEffort | null {
  return value === `minimal` ||
    value === `low` ||
    value === `medium` ||
    value === `high`
    ? value
    : null
}

export async function createBuiltinModelCatalog(
  options: BuiltinModelCatalogOptions = {}
): Promise<BuiltinModelCatalog | null> {
  const providers = configuredProviders()

  if (providers.length === 0 && options.allowMockFallback) {
    return mockFallbackCatalog()
  }

  const providerChoices = (
    await Promise.all(providers.map((provider) => choicesForProvider(provider)))
  ).flat()
  const choices = filterChoicesByEnabledModels(
    providerChoices,
    options.enabledModelValues
  )

  if (choices.length === 0) {
    return options.allowMockFallback ? mockFallbackCatalog() : null
  }

  const defaultChoice =
    choices.find(
      (choice) =>
        choice.provider === `anthropic` && choice.id === DEFAULT_ANTHROPIC_MODEL
    ) ??
    choices.find(
      (choice) =>
        choice.provider === `openai` && choice.id === DEFAULT_OPENAI_MODEL
    ) ??
    choices.find(
      (choice) =>
        choice.provider === `openai-codex` && choice.id === DEFAULT_CODEX_MODEL
    ) ??
    choices.find(
      (choice) =>
        choice.provider === `deepseek` && choice.id === DEFAULT_DEEPSEEK_MODEL
    ) ??
    choices.find(
      (choice) =>
        choice.provider === MOONSHOT_PROVIDER &&
        choice.id === DEFAULT_MOONSHOT_MODEL
    ) ??
    choices[0]!

  return { choices, defaultChoice }
}

export function resolveBuiltinModelConfig(
  catalog: BuiltinModelCatalog,
  args: Readonly<Record<string, unknown>>
): BuiltinAgentModelConfig {
  const modelArg = args.model
  const providerArg = args.provider
  const reasoningEffort = parseReasoningEffort(args.reasoningEffort)
  const selected =
    typeof modelArg === `string`
      ? catalog.choices.find(
          (choice) =>
            choice.value === modelArg ||
            (choice.id === modelArg && choice.provider === providerArg)
        )
      : undefined

  const choice = selected ?? catalog.defaultChoice
  const config = {
    provider: choice.provider,
    model: choice.id,
    ...(reasoningEffort && { reasoningEffort }),
    ...(choice.provider === `openai-codex` && {
      getApiKey: () => readCodexAccessToken(),
    }),
    ...(choice.provider === MOONSHOT_PROVIDER && {
      getApiKey: () => getMoonshotApiKey(),
    }),
  }

  return withProviderPayloadDefaults(config, choice, reasoningEffort)
}

export function modelChoiceValues(
  catalog: BuiltinModelCatalog
): [string, ...Array<string>] {
  return catalog.choices.map((choice) => choice.value) as [
    string,
    ...Array<string>,
  ]
}

export function modelInputSchemaDefs(
  catalog: BuiltinModelCatalog
): Record<string, unknown> {
  return {
    [MODEL_INPUTS_SCHEMA_DEF]: {
      type: `object`,
      properties: Object.fromEntries(
        catalog.choices.map((choice) => [
          choice.value,
          {
            type: `array`,
            items: { enum: [`text`, `image`] },
            default: choice.input,
          },
        ])
      ),
    },
  }
}
