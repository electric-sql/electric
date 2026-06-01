import type { SecretStore } from '../services/secret-store'
import type { ApiKeys, ApiKeysStatus, CodexStatus } from '../shared/types'

export const EMPTY_API_KEYS: ApiKeys = {
  anthropic: null,
  openai: null,
  deepseek: null,
  moonshot: null,
  brave: null,
}

export const GLOBAL_API_KEYS_REF = `api-keys:global`

export function captureEnvApiKeys(env: NodeJS.ProcessEnv): ApiKeys {
  return {
    anthropic: env.ANTHROPIC_API_KEY?.trim() || null,
    openai: env.OPENAI_API_KEY?.trim() || null,
    deepseek: env.DEEPSEEK_API_KEY?.trim() || null,
    moonshot: env.MOONSHOT_API_KEY?.trim() || null,
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
    moonshot: pick(maybe.moonshot),
    brave: pick(maybe.brave),
  }
}

export function hasAnyApiKey(keys: ApiKeys): boolean {
  return Boolean(
    keys.anthropic ||
      keys.openai ||
      keys.deepseek ||
      keys.moonshot ||
      keys.brave
  )
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
      | `MOONSHOT_API_KEY`
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
  resolveSlot(saved.moonshot, launchEnv.moonshot, `MOONSHOT_API_KEY`)
  resolveSlot(saved.brave, launchEnv.brave, `BRAVE_SEARCH_API_KEY`)
}

export type ApiKeyStatusDeps = {
  apiKeys: ApiKeys
  launchEnv: ApiKeys
  getCodexStatus: () => Promise<CodexStatus>
}

export async function getApiKeysStatus(
  deps: ApiKeyStatusDeps
): Promise<ApiKeysStatus> {
  const saved = deps.apiKeys
  // Brave is optional (falls back to Anthropic built-in search), so it doesn't
  // count toward "the app is configured".
  const hasAnyKey = Boolean(
    saved.anthropic || saved.openai || saved.deepseek || saved.moonshot
  )
  const suggested: ApiKeys = {
    anthropic: saved.anthropic ? null : deps.launchEnv.anthropic,
    openai: saved.openai ? null : deps.launchEnv.openai,
    deepseek: saved.deepseek ? null : deps.launchEnv.deepseek,
    moonshot: saved.moonshot ? null : deps.launchEnv.moonshot,
    brave: saved.brave ? null : deps.launchEnv.brave,
  }
  const codex = await deps.getCodexStatus()
  return { hasAnyKey: hasAnyKey || codex.enabled, saved, suggested, codex }
}

export type SetApiKeysDeps = {
  apiKeys: ApiKeys
  apiKeysRef: () => string
  secretStore: SecretStore
  launchEnv: ApiKeys
  saveSettings: () => Promise<void>
  markCredentialsDirty: () => void
  env: NodeJS.ProcessEnv
}

export async function setApiKeys(
  deps: SetApiKeysDeps,
  next: ApiKeys
): Promise<void> {
  const normalized = normalizeApiKeys(next)
  const changed =
    normalized.anthropic !== deps.apiKeys.anthropic ||
    normalized.openai !== deps.apiKeys.openai ||
    normalized.deepseek !== deps.apiKeys.deepseek ||
    normalized.moonshot !== deps.apiKeys.moonshot ||
    normalized.brave !== deps.apiKeys.brave
  Object.assign(deps.apiKeys, normalized)
  await saveApiKeysToSecret(deps.secretStore, deps.apiKeysRef(), deps.apiKeys)
  applyApiKeysToEnv(deps.apiKeys, deps.launchEnv, deps.env)
  await deps.saveSettings()
  if (changed) deps.markCredentialsDirty()
}
