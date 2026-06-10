import type {
  ApiKeys,
  DesktopSettings,
  RealtimeModelChoice,
  RealtimeSettings,
  RealtimeSettingsStatus,
} from '../shared/types'

export const DEFAULT_REALTIME_SETTINGS: RealtimeSettings = {
  provider: `openai`,
  model: `gpt-realtime-2`,
}

export const OPENAI_REALTIME_MODELS: Array<RealtimeModelChoice> = [
  {
    id: `gpt-realtime-2`,
    label: `GPT-Realtime-2`,
    description: `Strongest realtime reasoning, tool use, and instruction following.`,
    recommended: true,
  },
  {
    id: `gpt-realtime-1.5`,
    label: `GPT-Realtime-1.5`,
    description: `Fast, reliable speech-to-speech model for audio in, audio out.`,
  },
  {
    id: `gpt-realtime-mini`,
    label: `GPT-Realtime mini`,
    description: `Cost-efficient realtime voice model.`,
  },
]

const OPENAI_REALTIME_MODEL_IDS = new Set(
  OPENAI_REALTIME_MODELS.map((model) => model.id)
)

export function normalizeRealtimeSettings(value: unknown): RealtimeSettings {
  if (!value || typeof value !== `object`) return DEFAULT_REALTIME_SETTINGS
  const maybe = value as Partial<Record<keyof RealtimeSettings, unknown>>
  const model =
    typeof maybe.model === `string` &&
    OPENAI_REALTIME_MODEL_IDS.has(maybe.model)
      ? maybe.model
      : DEFAULT_REALTIME_SETTINGS.model
  return {
    provider: `openai`,
    model,
  }
}

export function realtimeSettingsStatus({
  settings,
  apiKeys,
  launchEnv,
}: {
  settings: DesktopSettings
  apiKeys: ApiKeys
  launchEnv: ApiKeys
}): RealtimeSettingsStatus {
  return {
    settings: normalizeRealtimeSettings(settings.realtime),
    availableModels: OPENAI_REALTIME_MODELS,
    hasOpenAIApiKey: Boolean(apiKeys.openai || launchEnv.openai),
    codexEnabled: settings.codex?.enabled === true,
  }
}
