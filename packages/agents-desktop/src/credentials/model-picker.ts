import {
  builtinModelProviderLabel,
  listBuiltinModelChoices,
  type BuiltinModelProvider,
} from '@electric-ax/agents'
import type {
  ApiKeys,
  CodexStatus,
  ModelPickerChoice,
  ModelPickerStatus,
} from '../shared/types'

export const DEFAULT_ENABLED_MODEL_VALUES = [
  `anthropic:claude-haiku-4-5`,
  `anthropic:claude-opus-4-5`,
  `anthropic:claude-opus-4-5-20251101`,
  `anthropic:claude-opus-4-7`,
  `anthropic:claude-sonnet-4-6`,
  `openai:gpt-5.5`,
  `openai-codex:gpt-5.4`,
  `openai-codex:gpt-5.5`,
  `deepseek:deepseek-v4-flash`,
  `deepseek:deepseek-v4-pro`,
  `moonshot:kimi-k2.6`,
]

export function normalizeEnabledModelValues(value: unknown): Array<string> {
  if (!Array.isArray(value)) return []
  const out: Array<string> = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== `string`) continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export function resolveEnabledModelValues(
  value: ReadonlyArray<string> | null | undefined
): Array<string> {
  const normalized = normalizeEnabledModelValues(value)
  return normalized.length > 0 ? normalized : DEFAULT_ENABLED_MODEL_VALUES
}

function hasModelKey(
  saved: ApiKeys,
  suggested: ApiKeys,
  key: keyof Pick<ApiKeys, `anthropic` | `openai` | `deepseek` | `moonshot`>
): boolean {
  return Boolean(saved[key] || suggested[key])
}

function configuredProviders(
  saved: ApiKeys,
  suggested: ApiKeys,
  codex: CodexStatus
): Array<BuiltinModelProvider> {
  const providers: Array<BuiltinModelProvider> = []
  if (hasModelKey(saved, suggested, `anthropic`)) providers.push(`anthropic`)
  if (hasModelKey(saved, suggested, `openai`)) providers.push(`openai`)
  if (hasModelKey(saved, suggested, `deepseek`)) providers.push(`deepseek`)
  if (hasModelKey(saved, suggested, `moonshot`)) providers.push(`moonshot`)
  if (codex.enabled) providers.push(`openai-codex`)
  return providers
}

export function createModelPickerStatus({
  saved,
  suggested,
  codex,
  enabledModelValues,
}: {
  saved: ApiKeys
  suggested: ApiKeys
  codex: CodexStatus
  enabledModelValues?: ReadonlyArray<string> | null
}): ModelPickerStatus {
  const choices: Array<ModelPickerChoice> = listBuiltinModelChoices(
    configuredProviders(saved, suggested, codex)
  ).map((choice) => ({
    provider: choice.provider,
    providerLabel: builtinModelProviderLabel(choice.provider),
    id: choice.id,
    label: choice.label,
    value: choice.value,
  }))

  const allValues = choices.map((choice) => choice.value)
  const availableValues = new Set(allValues)
  const savedEnabled = resolveEnabledModelValues(enabledModelValues)
  const enabled =
    savedEnabled.length === 0
      ? allValues
      : savedEnabled.filter((value) => availableValues.has(value))

  return {
    choices,
    enabled: enabled.length > 0 ? enabled : allValues,
  }
}
