import { getModels } from '@mariozechner/pi-ai'
import type { AgentConfig } from '@electric-ax/agents-runtime'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type BuiltinModelProvider = `anthropic` | `openai` | `openai-codex`

export interface BuiltinModelChoice {
  provider: BuiltinModelProvider
  id: string
  label: string
  value: string
  reasoning: boolean
}

export interface BuiltinModelCatalog {
  choices: Array<BuiltinModelChoice>
  defaultChoice: BuiltinModelChoice
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
  `model` | `provider` | `onPayload`
> & {
  reasoningEffort?: ExplicitReasoningEffort
}

type PersistedModelConfig = Pick<AgentConfig, `model` | `provider`> & {
  reasoningEffort?: ExplicitReasoningEffort
}

const DEFAULT_ANTHROPIC_MODEL = `claude-sonnet-4-6`
const DEFAULT_OPENAI_MODEL = `gpt-4.1`
const DEFAULT_CODEX_MODEL = `gpt-5.4`

function hasEnv(name: string): boolean {
  return (process.env[name]?.trim().length ?? 0) > 0
}

function codexAuthPath(): string {
  return join(homedir(), `.codex`, `auth.json`)
}

function readCodexAccessToken(): string | undefined {
  try {
    const raw = readFileSync(codexAuthPath(), `utf-8`)
    const data = JSON.parse(raw) as {
      auth_mode?: string
      tokens?: { access_token?: string }
    }
    if (data.auth_mode !== `chatgpt`) return undefined
    const token = data.tokens?.access_token?.trim()
    return token && token.length > 0 ? token : undefined
  } catch {
    return undefined
  }
}

function hasCodexAuth(): boolean {
  if (!existsSync(codexAuthPath())) return false
  return readCodexAccessToken() !== undefined
}

function modelValue(provider: BuiltinModelProvider, id: string): string {
  return `${provider}:${id}`
}

function providerLabel(provider: BuiltinModelProvider): string {
  if (provider === `anthropic`) return `Anthropic`
  if (provider === `openai-codex`) return `OpenAI Codex`
  return `OpenAI`
}

function configuredProviders(): Array<BuiltinModelProvider> {
  const providers: Array<BuiltinModelProvider> = []
  if (hasEnv(`ANTHROPIC_API_KEY`)) providers.push(`anthropic`)
  if (hasEnv(`OPENAI_API_KEY`)) providers.push(`openai`)
  if (hasCodexAuth()) providers.push(`openai-codex`)
  return providers
}

function mockFallbackCatalog(): BuiltinModelCatalog {
  const fallback = {
    provider: `anthropic` as const,
    id: DEFAULT_ANTHROPIC_MODEL,
    label: `Anthropic ${DEFAULT_ANTHROPIC_MODEL}`,
    value: modelValue(`anthropic`, DEFAULT_ANTHROPIC_MODEL),
    reasoning: true,
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

async function choicesForProvider(
  provider: BuiltinModelProvider
): Promise<Array<BuiltinModelChoice>> {
  const knownModels = getModels(provider)

  if (provider === `openai-codex`) {
    return knownModels.map((model) => ({
      provider,
      id: model.id,
      label: `${providerLabel(provider)} ${model.name}`,
      value: modelValue(provider, model.id),
      reasoning: model.reasoning,
    }))
  }

  const availableIds = await fetchAvailableModelIds(provider)
  const models =
    availableIds === null
      ? knownModels
      : knownModels.filter((model) => availableIds.has(model.id))

  return models.map((model) => ({
    provider,
    id: model.id,
    label: `${providerLabel(provider)} ${model.name}`,
    value: modelValue(provider, model.id),
    reasoning: model.reasoning,
  }))
}

function withProviderPayloadDefaults(
  config: PersistedModelConfig,
  choice: BuiltinModelChoice,
  reasoningEffort: ExplicitReasoningEffort | null
): BuiltinAgentModelConfig {
  if (choice.provider !== `openai` || !choice.reasoning) return config

  const effort = reasoningEffort ?? `minimal`

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

function parseReasoningEffort(value: unknown): ExplicitReasoningEffort | null {
  return value === `minimal` ||
    value === `low` ||
    value === `medium` ||
    value === `high`
    ? value
    : null
}

export async function createBuiltinModelCatalog(
  options: {
    allowMockFallback?: boolean
  } = {}
): Promise<BuiltinModelCatalog | null> {
  const providers = configuredProviders()

  if (providers.length === 0 && options.allowMockFallback) {
    return mockFallbackCatalog()
  }

  const choices = (
    await Promise.all(providers.map((provider) => choicesForProvider(provider)))
  ).flat()

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
