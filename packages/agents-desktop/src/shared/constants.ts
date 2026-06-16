export const APP_DISPLAY_NAME = `Electric Agents`
export const APP_WEBSITE_URL = `https://electric.ax/agents`
export const ELECTRIC_AGENTS_DOCS_URL = `https://electric-sql.com/docs/agents`
export const ELECTRIC_GITHUB_URL = `https://github.com/electric-sql/electric`
export const ELECTRIC_GITHUB_NEW_ISSUE_URL = `${ELECTRIC_GITHUB_URL}/issues/new`
export const LOCALHOST_HOST = `localhost`
export const LOOPBACK_IPV4_HOST = `127.0.0.1`
export const IGNORE_CONNECTION_LIMIT_DOMAINS = `${LOCALHOST_HOST},${LOOPBACK_IPV4_HOST}`

export const CODEX_AUTH_REF = `codex-auth:desktop`
export const CODEX_AUTH_CLAIMS_URL = `https://api.openai.com/auth`
export const CODEX_OAUTH_CLIENT_ID = `app_EMoamEEZ73f0CkXaXp7hrann`
export const CODEX_OAUTH_HOST = LOCALHOST_HOST
export const CODEX_OAUTH_ISSUER = `https://auth.openai.com`
export const CODEX_OAUTH_PORT = 1455
export const CODEX_OAUTH_REDIRECT_URI = `http://${CODEX_OAUTH_HOST}:${CODEX_OAUTH_PORT}/auth/callback`

export const ELECTRIC_CLOUD_DASHBOARD_URL = `https://dashboard.electric-sql.cloud`
export const ELECTRIC_CLOUD_AGENTS_URL = `https://agents.electric-sql.cloud`
export const ELECTRIC_CLOUD_AUTH_LOOPBACK_HOST = LOOPBACK_IPV4_HOST
export const ELECTRIC_CLOUD_AUTH_LOOPBACK_PORT = 53118
export const ELECTRIC_CLOUD_AUTH_CALLBACK_URL = `http://${ELECTRIC_CLOUD_AUTH_LOOPBACK_HOST}:${ELECTRIC_CLOUD_AUTH_LOOPBACK_PORT}/callback`

export const RECONNECT_BASE_MS = 1_000
export const RECONNECT_MAX_MS = 30_000

export const MCP_OAUTH_REDIRECT_BASE = `http://127.0.0.1:53117`
export const LOCAL_DISCOVERY_HOST = LOOPBACK_IPV4_HOST
export const URL_PATH_PARSE_BASE = `http://electric-agents.local`

export function localDiscoveryUrl(port: number): string {
  return `http://${LOCAL_DISCOVERY_HOST}:${port}`
}

export const DESKTOP_USER_DATA_DIR =
  process.env.ELECTRIC_DESKTOP_USER_DATA_DIR?.trim() || null
export const INITIAL_SERVER_URL =
  process.env.ELECTRIC_DESKTOP_SERVER_URL?.trim() ||
  process.env.ELECTRIC_AGENTS_SERVER_URL?.trim() ||
  null
export const DEV_SERVER_URL =
  process.env.ELECTRIC_DESKTOP_DEV_SERVER_URL ?? null
export const BACKGROUND_LAUNCH_ARG = `--electric-background-launch`

export const PULL_WAKE_RUNNER_ID =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_ID?.trim() || null
export const PULL_WAKE_RUNNER_LABEL =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_RUNNER_LABEL?.trim() || null
export const PULL_WAKE_REGISTER_RUNNER =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER === undefined
    ? true
    : [`1`, `true`].includes(
        process.env.ELECTRIC_DESKTOP_PULL_WAKE_REGISTER_RUNNER.trim().toLowerCase()
      )
export const PULL_WAKE_OWNER_PRINCIPAL =
  process.env.ELECTRIC_DESKTOP_PULL_WAKE_OWNER_PRINCIPAL?.trim() ||
  `/principal/system%3Adev-local`
export const DEFAULT_LOCAL_DEV_PRINCIPAL = `system:dev-local`

export function explicitDevPrincipalFromEnv(): string | null {
  const raw = process.env.ELECTRIC_DESKTOP_PRINCIPAL?.trim() || null
  if (!raw) return null
  const colon = raw.indexOf(`:`)
  if (colon <= 0) {
    console.error(
      `[agents-desktop] ELECTRIC_DESKTOP_PRINCIPAL="${raw}" is invalid. ` +
        `Expected format: "kind:id" (e.g. "system:dev-local"). Ignoring.`
    )
    return null
  }
  console.info(`[agents-desktop] Using dev principal: ${raw}`)
  return raw
}

export const EXTERNAL_LINK_PROTOCOLS = new Set([`http:`, `https:`, `mailto:`])

export const DISCOVERY_PORTS: ReadonlyArray<number> = [
  4437, 4438, 4439, 3000, 4000, 8080,
]
export const DISCOVERY_TIMEOUT_MS = 1500
export const DISCOVERY_INTERVAL_MS = 30_000
