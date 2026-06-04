import { BrowserWindow, app, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import path from 'node:path'
import {
  CODEX_AUTH_CLAIMS_URL,
  CODEX_AUTH_REF,
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_ISSUER,
  CODEX_OAUTH_PORT,
  CODEX_OAUTH_REDIRECT_URI,
} from '../shared/constants'
import { normalizeCodexSettings } from '../settings/store'
import type { SecretStore } from '../services/secret-store'
import type {
  CodexAuthSource,
  CodexDetectedSource,
  CodexStatus,
  DesktopSettings,
} from '../shared/types'

type StoredCodexAuth = {
  source: CodexAuthSource
  access: string | null
  refresh: string | null
  expiresAt: number | null
  accountId: string | null
  email: string | null
}

export type CodexAuthDeps = {
  settings: DesktopSettings
  getSecretStore: () => SecretStore
  saveSettings: () => Promise<void>
  markCredentialsDirty: () => void
}

function codexEmptyStatus(
  deps: Pick<CodexAuthDeps, `settings`>,
  error: string | null = null
): CodexStatus {
  const codex = deps.settings.codex ?? { enabled: false, source: null }
  return {
    enabled: codex.enabled,
    source: codex.source,
    availableSources: [],
    accountId: null,
    email: null,
    expiresAt: null,
    error,
  }
}

async function readJson(pathName: string): Promise<unknown> {
  return JSON.parse(await readFile(pathName, `utf8`)) as unknown
}

function pickString(value: unknown): string | null {
  return typeof value === `string` && value.trim().length > 0
    ? value.trim()
    : null
}

function parseJwtClaims(token: string | null): Record<string, unknown> | null {
  if (!token) return null
  const parts = token.split(`.`)
  if (parts.length !== 3) return null
  try {
    return JSON.parse(Buffer.from(parts[1]!, `base64url`).toString()) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

function codexAccountIdFromClaims(
  claims: Record<string, unknown> | null
): string | null {
  if (!claims) return null
  const nested =
    claims[CODEX_AUTH_CLAIMS_URL] &&
    typeof claims[CODEX_AUTH_CLAIMS_URL] === `object`
      ? (claims[CODEX_AUTH_CLAIMS_URL] as Record<string, unknown>)
      : null
  const organizations = Array.isArray(claims.organizations)
    ? claims.organizations
    : []
  const organization = organizations.find((entry): entry is { id: string } =>
    Boolean(
      entry &&
        typeof entry === `object` &&
        typeof (entry as { id?: unknown }).id === `string`
    )
  )
  return (
    pickString(claims.chatgpt_account_id) ??
    pickString(nested?.chatgpt_account_id) ??
    organization?.id ??
    null
  )
}

function codexAuthFromTokenResponse(
  source: CodexAuthSource,
  tokens: {
    access_token?: unknown
    refresh_token?: unknown
    expires_in?: unknown
    id_token?: unknown
  },
  fallback?: Partial<StoredCodexAuth>
): StoredCodexAuth | null {
  const access = pickString(tokens.access_token) ?? fallback?.access ?? null
  const refresh = pickString(tokens.refresh_token) ?? fallback?.refresh ?? null
  if (!access && !refresh) return null
  const idClaims = parseJwtClaims(pickString(tokens.id_token))
  const accessClaims = parseJwtClaims(access)
  const email = pickString(idClaims?.email) ?? fallback?.email ?? null
  const accountId =
    codexAccountIdFromClaims(idClaims) ??
    codexAccountIdFromClaims(accessClaims) ??
    fallback?.accountId ??
    null
  const expiresIn =
    typeof tokens.expires_in === `number`
      ? tokens.expires_in
      : Number(tokens.expires_in)
  return {
    source,
    access,
    refresh,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : (fallback?.expiresAt ?? null),
    accountId,
    email,
  }
}

function codexCliAuthPath(): string {
  return (
    process.env.CODEX_AUTH_PATH?.trim() ||
    path.join(app.getPath(`home`), `.codex`, `auth.json`)
  )
}

function opencodeAuthPaths(): Array<string> {
  const home = app.getPath(`home`)
  const paths = [path.join(home, `.local`, `share`, `opencode`, `auth.json`)]
  if (process.platform === `darwin`) {
    paths.push(
      path.join(home, `Library`, `Application Support`, `opencode`, `auth.json`)
    )
  }
  return paths
}

function parseCodexCliAuth(value: unknown): StoredCodexAuth | null {
  if (!value || typeof value !== `object`) return null
  const data = value as Record<string, unknown>
  if (data.auth_mode !== `chatgpt`) return null
  const tokens =
    data.tokens && typeof data.tokens === `object`
      ? (data.tokens as Record<string, unknown>)
      : {}
  return codexAuthFromTokenResponse(`codex-cli`, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    id_token: tokens.id_token,
    expires_in: tokens.expires_in,
  })
}

function parseOpencodeAuth(value: unknown): StoredCodexAuth | null {
  if (!value || typeof value !== `object`) return null
  const openai = (value as Record<string, unknown>).openai
  if (!openai || typeof openai !== `object`) return null
  const data = openai as Record<string, unknown>
  if (data.type !== `oauth`) return null
  const access = pickString(data.access)
  const refresh = pickString(data.refresh)
  if (!access && !refresh) return null
  return {
    source: `opencode`,
    access,
    refresh,
    expiresAt:
      typeof data.expires === `number` && Number.isFinite(data.expires)
        ? data.expires
        : null,
    accountId: pickString(data.accountId),
    email: null,
  }
}

async function loadStoredCodexAuth(
  deps: Pick<CodexAuthDeps, `getSecretStore`>
): Promise<StoredCodexAuth | null> {
  const raw = await deps.getSecretStore().get(CODEX_AUTH_REF)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<StoredCodexAuth>
    const source = normalizeCodexSettings({
      enabled: true,
      source: parsed.source,
    }).source
    if (!source) return null
    return {
      source,
      access: pickString(parsed.access),
      refresh: pickString(parsed.refresh),
      expiresAt:
        typeof parsed.expiresAt === `number` &&
        Number.isFinite(parsed.expiresAt)
          ? parsed.expiresAt
          : null,
      accountId: pickString(parsed.accountId),
      email: pickString(parsed.email),
    }
  } catch {
    return null
  }
}

async function saveStoredCodexAuth(
  deps: Pick<CodexAuthDeps, `getSecretStore`>,
  auth: StoredCodexAuth
): Promise<void> {
  await deps.getSecretStore().set(CODEX_AUTH_REF, JSON.stringify(auth))
}

async function loadDetectedCodexAuth(
  deps: Pick<CodexAuthDeps, `getSecretStore`>,
  source: CodexAuthSource
): Promise<StoredCodexAuth | null> {
  if (source === `desktop-oauth`) return loadStoredCodexAuth(deps)
  if (source === `codex-cli`) {
    try {
      return parseCodexCliAuth(await readJson(codexCliAuthPath()))
    } catch {
      return null
    }
  }
  for (const candidate of opencodeAuthPaths()) {
    try {
      const auth = parseOpencodeAuth(await readJson(candidate))
      if (auth) return auth
    } catch {
      // Try the next platform path.
    }
  }
  return null
}

async function refreshCodexAuthIfNeeded(
  deps: Pick<CodexAuthDeps, `getSecretStore`>,
  auth: StoredCodexAuth
): Promise<StoredCodexAuth | null> {
  if (!auth.refresh) return auth.access ? auth : null
  if (auth.access && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
    return auth
  }
  const res = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
    method: `POST`,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
    body: new URLSearchParams({
      grant_type: `refresh_token`,
      refresh_token: auth.refresh,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) return null
  const next = codexAuthFromTokenResponse(
    auth.source,
    (await res.json()) as Record<string, unknown>,
    auth
  )
  if (next) await saveStoredCodexAuth(deps, next)
  return next
}

async function clearCodexAuth(deps: CodexAuthDeps): Promise<void> {
  deps.settings.codex = { enabled: false, source: null }
  await deps.getSecretStore().delete(CODEX_AUTH_REF)
  await deps.saveSettings()
  deps.markCredentialsDirty()
}

export async function syncCodexEnvironment(deps: CodexAuthDeps): Promise<void> {
  process.env.ELECTRIC_CODEX_REQUIRE_OPT_IN = `1`
  const codex = deps.settings.codex ?? { enabled: false, source: null }
  if (!codex.enabled || !codex.source) {
    delete process.env.ELECTRIC_CODEX_ACCESS_TOKEN
    return
  }

  const stored = await loadStoredCodexAuth(deps)
  const refreshed =
    stored?.source === codex.source
      ? await refreshCodexAuthIfNeeded(deps, stored)
      : null
  if (refreshed?.access) {
    process.env.ELECTRIC_CODEX_ACCESS_TOKEN = refreshed.access
    return
  }

  // Avoid showing a false "Enabled" state when no usable access token can be
  // produced. Desktop OAuth tokens should refresh through the OAuth token
  // endpoint above; stale tokens imported from CLI/opencode auth files should be
  // deleted rather than repeatedly trusted as an enabled desktop credential.
  delete process.env.ELECTRIC_CODEX_ACCESS_TOKEN
  await clearCodexAuth(deps)
}

async function detectCodexSources(
  deps: Pick<CodexAuthDeps, `getSecretStore`>
): Promise<Array<CodexDetectedSource>> {
  const sources: Array<CodexDetectedSource> = []
  const stored = await loadStoredCodexAuth(deps)
  if (stored?.access || stored?.refresh) {
    sources.push({
      source: `desktop-oauth`,
      label: `Electric Agents ChatGPT / Codex sign-in`,
      accountId: stored.accountId,
      email: stored.email,
      expiresAt: stored.expiresAt,
    })
  }
  const cli = await loadDetectedCodexAuth(deps, `codex-cli`)
  if (cli?.access || cli?.refresh) {
    sources.push({
      source: `codex-cli`,
      label: `ChatGPT / Codex CLI login`,
      accountId: cli.accountId,
      email: cli.email,
      expiresAt: cli.expiresAt,
    })
  }
  const opencode = await loadDetectedCodexAuth(deps, `opencode`)
  if (opencode?.access || opencode?.refresh) {
    sources.push({
      source: `opencode`,
      label: `OpenCode ChatGPT / Codex login`,
      accountId: opencode.accountId,
      email: opencode.email,
      expiresAt: opencode.expiresAt,
    })
  }
  return sources
}

export async function getCodexStatus(
  deps: Pick<CodexAuthDeps, `settings` | `getSecretStore`>
): Promise<CodexStatus> {
  try {
    const availableSources = await detectCodexSources(deps)
    const stored = await loadStoredCodexAuth(deps)
    const codex = deps.settings.codex ?? { enabled: false, source: null }
    return {
      enabled: codex.enabled && Boolean(stored),
      source: codex.enabled && stored ? codex.source : null,
      availableSources,
      accountId: stored?.accountId ?? null,
      email: stored?.email ?? null,
      expiresAt: stored?.expiresAt ?? null,
      error: null,
    }
  } catch (error) {
    return codexEmptyStatus(
      deps,
      error instanceof Error ? error.message : String(error)
    )
  }
}

export async function enableCodexSource(
  deps: CodexAuthDeps,
  source: CodexAuthSource
): Promise<CodexStatus> {
  const auth = await loadDetectedCodexAuth(deps, source)
  if (!auth) {
    throw new Error(`No ${source} Codex login was found.`)
  }
  const refreshed = await refreshCodexAuthIfNeeded(deps, auth)
  await saveStoredCodexAuth(deps, refreshed ?? auth)
  deps.settings.codex = { enabled: true, source }
  await deps.saveSettings()
  await syncCodexEnvironment(deps)
  deps.markCredentialsDirty()
  return getCodexStatus(deps)
}

export async function disableCodex(deps: CodexAuthDeps): Promise<CodexStatus> {
  deps.settings.codex = { enabled: false, source: null }
  await deps.getSecretStore().delete(CODEX_AUTH_REF)
  await deps.saveSettings()
  await syncCodexEnvironment(deps)
  deps.markCredentialsDirty()
  return getCodexStatus(deps)
}

function base64Url(bytes: Buffer): string {
  return bytes
    .toString(`base64`)
    .replace(/\+/g, `-`)
    .replace(/\//g, `_`)
    .replace(/=+$/, ``)
}

function codexSignInWaitingHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sign in to ChatGPT / Codex</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
    margin: 0;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-height: 100vh;
    box-sizing: border-box;
    -webkit-user-select: none;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0; }
  p { margin: 0; line-height: 1.5; color: GrayText; font-size: 13px; }
  .spinner {
    width: 24px; height: 24px;
    border-radius: 50%;
    border: 3px solid color-mix(in oklab, CanvasText 12%, Canvas);
    border-top-color: color-mix(in oklab, CanvasText 70%, Canvas);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .actions { margin-top: auto; display: flex; justify-content: flex-end; }
  button {
    font: inherit; font-weight: 500;
    padding: 6px 14px; border-radius: 6px;
    border: 1px solid color-mix(in oklab, CanvasText 18%, Canvas);
    background: Canvas; color: CanvasText;
    cursor: pointer;
  }
  button:hover { background: color-mix(in oklab, CanvasText 6%, Canvas); }
</style>
</head>
<body>
  <div class="spinner" aria-hidden="true"></div>
  <h1>Waiting for sign-in…</h1>
  <p>We've opened the OpenAI sign-in page in your default browser. After you finish there, this window will close automatically.</p>
  <div class="actions">
    <button type="button" onclick="window.close()">Cancel</button>
  </div>
</body>
</html>`
}

function codexSignInSuccessHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Signed in to ChatGPT / Codex</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: Canvas;
    color: CanvasText;
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    box-sizing: border-box;
  }
  .card {
    max-width: 420px;
    text-align: center;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h1 { font-size: 18px; font-weight: 600; margin: 0; }
  p { margin: 0; line-height: 1.5; color: GrayText; font-size: 14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>You're signed in</h1>
    <p>You can close this tab and return to Electric Agents.</p>
  </div>
</body>
</html>`
}

export async function signInCodex(
  deps: CodexAuthDeps
): Promise<CodexStatus | null> {
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash(`sha256`).update(verifier).digest())
  const state = base64Url(randomBytes(32))
  const redirectUri = CODEX_OAUTH_REDIRECT_URI
  const authorizeUrl = `${CODEX_OAUTH_ISSUER}/oauth/authorize?${new URLSearchParams(
    {
      response_type: `code`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: `openid profile email offline_access`,
      code_challenge: challenge,
      code_challenge_method: `S256`,
      id_token_add_organizations: `true`,
      codex_cli_simplified_flow: `true`,
      state,
      originator: `electric-agents`,
    }
  ).toString()}`

  const serverRef: { current: HttpServer | null } = { current: null }
  const winRef: { current: BrowserWindow | null } = { current: null }
  try {
    const code = await new Promise<string | null>((resolve, reject) => {
      let done = false
      const timeout = setTimeout(() => {
        reject(new Error(`Codex sign-in timed out.`))
      }, 5 * 60_000)
      const settle = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(timeout)
        fn()
      }
      serverRef.current = createServer((req, res) => {
        const url = new URL(req.url ?? `/`, redirectUri)
        if (url.pathname !== `/auth/callback`) {
          res.writeHead(404)
          res.end(`Not found`)
          return
        }
        const error =
          url.searchParams.get(`error_description`) ??
          url.searchParams.get(`error`)
        const returnedState = url.searchParams.get(`state`)
        const returnedCode = url.searchParams.get(`code`)
        if (error || returnedState !== state || !returnedCode) {
          res.writeHead(400, { 'Content-Type': `text/html` })
          res.end(`<html><body>Codex authorization failed.</body></html>`)
          settle(() =>
            reject(new Error(error ?? `Invalid Codex OAuth callback.`))
          )
          return
        }
        res.writeHead(200, { 'Content-Type': `text/html; charset=utf-8` })
        res.end(codexSignInSuccessHtml())
        settle(() => resolve(returnedCode))
      })
      serverRef.current.listen(
        CODEX_OAUTH_PORT,
        new URL(redirectUri).hostname,
        () => {
          winRef.current = new BrowserWindow({
            title: `Sign in to ChatGPT / Codex`,
            width: 460,
            height: 280,
            resizable: false,
            minimizable: false,
            maximizable: false,
            autoHideMenuBar: true,
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          })
          winRef.current.on(`closed`, () => {
            winRef.current = null
            settle(() => resolve(null))
          })
          void winRef.current.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(
              codexSignInWaitingHtml()
            )}`
          )
          void shell.openExternal(authorizeUrl).catch((err) => {
            settle(() =>
              reject(
                err instanceof Error
                  ? err
                  : new Error(`Could not open browser for Codex sign-in.`)
              )
            )
          })
        }
      )
      serverRef.current.on(`error`, (error) => {
        settle(() => reject(error))
      })
    })

    if (code === null) return null

    const res = await fetch(`${CODEX_OAUTH_ISSUER}/oauth/token`, {
      method: `POST`,
      headers: { 'Content-Type': `application/x-www-form-urlencoded` },
      body: new URLSearchParams({
        grant_type: `authorization_code`,
        code,
        redirect_uri: redirectUri,
        client_id: CODEX_OAUTH_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Codex token exchange failed: ${res.status}`)
    const auth = codexAuthFromTokenResponse(
      `desktop-oauth`,
      (await res.json()) as Record<string, unknown>
    )
    if (!auth) throw new Error(`Codex sign-in did not return usable tokens.`)
    await saveStoredCodexAuth(deps, auth)
    deps.settings.codex = { enabled: true, source: `desktop-oauth` }
    await deps.saveSettings()
    await syncCodexEnvironment(deps)
    deps.markCredentialsDirty()
    return getCodexStatus(deps)
  } finally {
    const currentWin = winRef.current
    const currentServer = serverRef.current
    if (currentWin && !currentWin.isDestroyed()) currentWin.close()
    if (currentServer) {
      try {
        currentServer.close()
      } catch {
        // The server may have failed before it started listening.
      }
    }
  }
}
