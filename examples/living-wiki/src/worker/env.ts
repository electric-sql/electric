export type WorkerEnv = {
  ASSETS?: Fetcher
  APP_ENV: string
  ELECTRIC_CLOUD_API_URL: string
  ELECTRIC_CLOUD_API_TOKEN?: string
  ELECTRIC_AGENTS_SPACE_ID: string
  /** Electric Agents runtime base URL used only by Worker-side proxy code. */
  ELECTRIC_AGENTS_BASE_URL?: string
  /** Secret Agents runtime token. Never expose in browser-facing JSON. */
  ELECTRIC_AGENTS_TOKEN?: string
  /** Optional principal header value for Agents runtime calls. Never expose. */
  ELECTRIC_AGENTS_PRINCIPAL_KEY?: string
  ENABLE_SEEDED_DEMO?: string
}

export type AgentsRuntimeConfig = {
  configured: boolean
  /** Normalized Agents runtime base URL without a trailing slash. */
  baseUrl: string | undefined
  /** Secret presence only; the token value remains on WorkerEnv. */
  hasToken: boolean
  /** Secret presence only; the principal key value remains on WorkerEnv. */
  hasPrincipalKey: boolean
}

export function isSeededDemoEnabled(env: WorkerEnv): boolean {
  return env.ENABLE_SEEDED_DEMO === `true`
}

export function getAgentsRuntimeConfig(env: WorkerEnv): AgentsRuntimeConfig {
  const baseUrl = env.ELECTRIC_AGENTS_BASE_URL?.trim()

  return {
    configured: Boolean(baseUrl),
    baseUrl: baseUrl ? normalizeAgentsBaseUrl(baseUrl) : undefined,
    hasToken: Boolean(env.ELECTRIC_AGENTS_TOKEN),
    hasPrincipalKey: Boolean(env.ELECTRIC_AGENTS_PRINCIPAL_KEY),
  }
}

function normalizeAgentsBaseUrl(value: string): string {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid ELECTRIC_AGENTS_BASE_URL`)
  }

  if (url.protocol !== `https:` && url.protocol !== `http:`) {
    throw new Error(`Invalid ELECTRIC_AGENTS_BASE_URL`)
  }

  return url.toString().replace(/\/$/, ``)
}
