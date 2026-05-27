import type { SecretStore } from '../secret-store'
import type { ApiKeys } from '../shared/types'

export const EMPTY_API_KEYS: ApiKeys = {
  anthropic: null,
  openai: null,
  deepseek: null,
  brave: null,
}

export function captureEnvApiKeys(env: NodeJS.ProcessEnv): ApiKeys {
  return {
    anthropic: env.ANTHROPIC_API_KEY?.trim() || null,
    openai: env.OPENAI_API_KEY?.trim() || null,
    deepseek: env.DEEPSEEK_API_KEY?.trim() || null,
    brave: env.BRAVE_SEARCH_API_KEY?.trim() || null,
  }
}

export function normalizeApiKeys(value: unknown): ApiKeys {
  if (!value || typeof value !== `object`) return { ...EMPTY_API_KEYS }
  const maybe = value as Partial<Record<keyof ApiKeys, unknown>>
  const pick = (raw: unknown): string | null => {
    if (typeof raw !== `string`) return null
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return {
    anthropic: pick(maybe.anthropic),
    openai: pick(maybe.openai),
    deepseek: pick(maybe.deepseek),
    brave: pick(maybe.brave),
  }
}

export function hasAnyApiKey(keys: ApiKeys): boolean {
  return Boolean(keys.anthropic || keys.openai || keys.deepseek || keys.brave)
}

export async function loadApiKeysFromSecret(
  store: SecretStore,
  ref: string
): Promise<ApiKeys> {
  const raw = await store.get(ref)
  if (!raw) return { ...EMPTY_API_KEYS }
  try {
    return normalizeApiKeys(JSON.parse(raw))
  } catch {
    return { ...EMPTY_API_KEYS }
  }
}

export async function saveApiKeysToSecret(
  store: SecretStore,
  ref: string,
  keys: ApiKeys
): Promise<void> {
  if (hasAnyApiKey(keys)) {
    await store.set(ref, JSON.stringify(keys))
  } else {
    await store.delete(ref)
  }
}

/**
 * Mirror persisted API keys into `process.env` so the bundled
 * `BuiltinAgentsServer` sees them on its next start. Saved values take
 * precedence; unset slots fall back to whatever was in the launch environment.
 */
export function applyApiKeysToEnv(
  saved: ApiKeys,
  launchEnv: ApiKeys,
  env: NodeJS.ProcessEnv
): void {
  const resolveSlot = (
    value: string | null,
    fallback: string | null,
    name:
      | `ANTHROPIC_API_KEY`
      | `OPENAI_API_KEY`
      | `DEEPSEEK_API_KEY`
      | `BRAVE_SEARCH_API_KEY`
  ): void => {
    const next = value ?? fallback
    if (next) {
      env[name] = next
    } else {
      delete env[name]
    }
  }
  resolveSlot(saved.anthropic, launchEnv.anthropic, `ANTHROPIC_API_KEY`)
  resolveSlot(saved.openai, launchEnv.openai, `OPENAI_API_KEY`)
  resolveSlot(saved.deepseek, launchEnv.deepseek, `DEEPSEEK_API_KEY`)
  resolveSlot(saved.brave, launchEnv.brave, `BRAVE_SEARCH_API_KEY`)
}
