import { createHash } from 'node:crypto'
import type {
  ApiKeys,
  DesktopSettings,
  RealtimeCredentialStatus,
  RealtimeSettings,
  RealtimeSettingsStatus,
} from '../shared/types'
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_REASONING_EFFORT,
  DEFAULT_OPENAI_REALTIME_VOICE,
  OPENAI_REALTIME_MODELS,
  OPENAI_REALTIME_REASONING_EFFORTS,
  OPENAI_REALTIME_VOICES,
  isOpenAIRealtimeModel,
  isOpenAIRealtimeReasoningEffort,
  isOpenAIRealtimeVoice,
} from '@electric-ax/agents-runtime'

export const DEFAULT_REALTIME_SETTINGS: RealtimeSettings = {
  provider: `openai`,
  model: DEFAULT_OPENAI_REALTIME_MODEL,
  voice: DEFAULT_OPENAI_REALTIME_VOICE,
  reasoningEffort: DEFAULT_OPENAI_REALTIME_REASONING_EFFORT,
  interruptResponse: true,
}

const OPENAI_REALTIME_VALIDATION_TTL_MS = 5 * 60 * 1000

type RealtimeCredentialValidation = {
  openAIApiKeyStatus: RealtimeCredentialStatus
  openAIApiKeyError?: string
}

const validationCache = new Map<
  string,
  { expiresAt: number; result: RealtimeCredentialValidation }
>()

export function normalizeRealtimeSettings(value: unknown): RealtimeSettings {
  if (!value || typeof value !== `object`) return DEFAULT_REALTIME_SETTINGS
  const maybe = value as Partial<Record<keyof RealtimeSettings, unknown>>
  return {
    provider: `openai`,
    model: isOpenAIRealtimeModel(maybe.model)
      ? maybe.model
      : DEFAULT_REALTIME_SETTINGS.model,
    voice: isOpenAIRealtimeVoice(maybe.voice)
      ? maybe.voice
      : DEFAULT_REALTIME_SETTINGS.voice,
    reasoningEffort: isOpenAIRealtimeReasoningEffort(maybe.reasoningEffort)
      ? maybe.reasoningEffort
      : DEFAULT_REALTIME_SETTINGS.reasoningEffort,
    interruptResponse:
      typeof maybe.interruptResponse === `boolean`
        ? maybe.interruptResponse
        : DEFAULT_REALTIME_SETTINGS.interruptResponse,
  }
}

function validationCacheKey(apiKey: string, model: string): string {
  const keyHash = createHash(`sha256`).update(apiKey).digest(`hex`)
  return `${keyHash}:${model}`
}

async function validateOpenAIRealtimeApiKey(
  apiKey: string | null | undefined,
  model: string
): Promise<RealtimeCredentialValidation> {
  if (!apiKey) {
    return { openAIApiKeyStatus: `missing` }
  }

  const cacheKey = validationCacheKey(apiKey, model)
  const cached = validationCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  let result: RealtimeCredentialValidation
  try {
    const response = await fetch(
      `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    )
    if (response.ok) {
      result = { openAIApiKeyStatus: `valid` }
    } else if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      result = {
        openAIApiKeyStatus: `invalid`,
        openAIApiKeyError:
          response.status === 404
            ? `OpenAI API key cannot access ${model}.`
            : `OpenAI API key was rejected (${response.status}).`,
      }
    } else {
      result = {
        openAIApiKeyStatus: `unknown`,
        openAIApiKeyError: `OpenAI credential check failed (${response.status}).`,
      }
    }
  } catch (error) {
    result = {
      openAIApiKeyStatus: `unknown`,
      openAIApiKeyError: error instanceof Error ? error.message : String(error),
    }
  }

  validationCache.set(cacheKey, {
    expiresAt: Date.now() + OPENAI_REALTIME_VALIDATION_TTL_MS,
    result,
  })
  return result
}

export async function realtimeSettingsStatus({
  settings,
  apiKeys,
  launchEnv,
}: {
  settings: DesktopSettings
  apiKeys: ApiKeys
  launchEnv: ApiKeys
}): Promise<RealtimeSettingsStatus> {
  const normalized = normalizeRealtimeSettings(settings.realtime)
  const apiKey = apiKeys.openai || launchEnv.openai
  const validation = await validateOpenAIRealtimeApiKey(
    apiKey,
    normalized.model
  )
  return {
    settings: normalized,
    availableModels: [...OPENAI_REALTIME_MODELS],
    availableVoices: [...OPENAI_REALTIME_VOICES],
    availableReasoningEfforts: [...OPENAI_REALTIME_REASONING_EFFORTS],
    hasOpenAIApiKey: Boolean(apiKey),
    ...validation,
    codexEnabled: settings.codex?.enabled === true,
  }
}
