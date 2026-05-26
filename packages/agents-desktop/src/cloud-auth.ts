import { BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SecretStore } from './secret-store'

/**
 * Electric Cloud sign-in flow.
 *
 * Reuses the same loopback-redirect OAuth flow the `electric` CLI uses:
 *
 *   1. Generate a UUID `state` and pick a stable loopback "port" number
 *      to thread through as `cli_port`.
 *   2. Open the dashboard's `/api/public/auth/{provider}/login` URL in a
 *      sandboxed `BrowserWindow`. The user signs in with GitHub or
 *      Google there.
 *   3. The admin-API callback issues a JWT and 302s the BrowserWindow to
 *      `http://127.0.0.1:{cli_port}/callback?token=...&state=...&email=...&expiresAt=...`.
 *   4. We intercept that redirect via `webContents.on('will-redirect')`
 *      *before* it leaves the renderer — nothing actually listens on
 *      `cli_port`, the URL is just a CSRF-validated message channel.
 *   5. We pull `token`, `email`, `expiresAt` off the URL, validate
 *      `state`, persist the JWT through `SecretStore`, and surface the
 *      session to renderers.
 *
 * The JWT is the only token type the admin-API issues (HS256, 7-day
 * TTL). The Electron app holds it in encrypted storage and sends it as
 * `Authorization: Bearer …` on subsequent admin-API calls.
 */

export type CloudAuthProvider = `github` | `google`

export type CloudAuthStatus =
  | `signed-out`
  | `signing-in`
  | `signed-in`
  | `error`

export type CloudAuthWorkspace = {
  id: string
  name: string
}

export type CloudAuthState = {
  status: CloudAuthStatus
  email: string | null
  name: string | null
  userId: string | null
  workspaces: ReadonlyArray<CloudAuthWorkspace> | null
  error: string | null
}

type CloudAuthSecret = {
  token: string
  email: string
  expiresAt: string
  provider: CloudAuthProvider
}

/**
 * Subset of the admin-API `auth.whoami` response the UI needs.
 * Mirrors the user branch of `packages/admin-api/src/orpc/procedures/auth/whoami.ts`.
 */
type WhoamiUserResponse = {
  type: `user`
  userId: string
  name: string
  email: string
  workspaces: ReadonlyArray<CloudAuthWorkspace>
}

const SECRET_REF = `cloud-auth:default`

// Stable loopback "port" threaded through the OAuth flow as `cli_port`.
// Nothing listens here — the BrowserWindow intercepts the redirect by
// URL prefix before any HTTP request goes out. Picked from the IANA
// dynamic/private range and distinct from the MCP DCR port (53117).
const CLI_PORT = 53118

const PROD_DASHBOARD_URL = `https://dashboard.electric-sql.cloud`

/**
 * Resolve the Electric Cloud dashboard / admin-API base URL.
 *
 * Both the OAuth login endpoints and the oRPC API live under the same
 * origin in production (`dashboard.electric-sql.cloud`), so a single
 * env-var override is enough to point the Electron app at a dev /
 * staging cluster. Matches the CLI's `ELECTRIC_DASHBOARD_URL`
 * convention.
 */
export function getCloudBaseUrl(): string {
  const fromEnv = process.env.ELECTRIC_DASHBOARD_URL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : PROD_DASHBOARD_URL
}

const PROD_AGENTS_URL = `https://agents.electric-sql.cloud`

/**
 * Resolve the Electric Cloud agents server base URL.
 *
 * The cloud agents server is a sibling of the dashboard / admin-API
 * with the same stage suffix — e.g. `dashboard-pr-1502.electric-sql.dev`
 * pairs with `agents-pr-1502.electric-sql.dev`. We honor an explicit
 * `ELECTRIC_AGENTS_URL` override first, then try to derive it by
 * swapping `dashboard` → `agents` in the configured dashboard URL,
 * and finally fall back to the production agents URL.
 */
export function getCloudAgentsBaseUrl(): string {
  const fromEnv = process.env.ELECTRIC_AGENTS_URL?.trim()
  if (fromEnv && fromEnv.length > 0) return fromEnv
  const dashboardUrl = getCloudBaseUrl()
  try {
    const url = new URL(dashboardUrl)
    if (/^dashboard([.-]|$)/.test(url.hostname)) {
      url.hostname = url.hostname.replace(/^dashboard(?=[.-]|$)/, `agents`)
      // Strip path/query — agents server is host-only.
      url.pathname = `/`
      url.search = ``
      return url.toString().replace(/\/$/, ``)
    }
  } catch {
    // Fall through to prod default.
  }
  return PROD_AGENTS_URL
}

function loopbackPrefix(): string {
  return `http://127.0.0.1:${CLI_PORT}/callback`
}

function authorizeUrl(provider: CloudAuthProvider, state: string): string {
  const url = new URL(`/api/public/auth/${provider}/login`, getCloudBaseUrl())
  url.searchParams.set(`cli_port`, String(CLI_PORT))
  url.searchParams.set(`cli_state`, state)
  return url.toString()
}

function parseWhoamiUserResponse(body: unknown): WhoamiUserResponse | null {
  if (!body || typeof body !== `object`) return null
  // RPC response shape is `{ json: <result>, meta?: [...] }`. Older
  // ad-hoc handlers might return the result un-wrapped, so accept both.
  const json =
    `json` in (body as Record<string, unknown>) &&
    typeof (body as { json: unknown }).json === `object`
      ? ((body as { json: unknown }).json as Record<string, unknown>)
      : (body as Record<string, unknown>)
  if (json.type !== `user`) return null
  if (
    typeof json.userId !== `string` ||
    typeof json.email !== `string` ||
    typeof json.name !== `string` ||
    !Array.isArray(json.workspaces)
  ) {
    return null
  }
  const workspaces: Array<CloudAuthWorkspace> = []
  for (const entry of json.workspaces) {
    if (
      entry &&
      typeof entry === `object` &&
      typeof (entry as { id: unknown }).id === `string` &&
      typeof (entry as { name: unknown }).name === `string`
    ) {
      workspaces.push({
        id: (entry as { id: string }).id,
        name: (entry as { name: string }).name,
      })
    }
  }
  return {
    type: `user`,
    userId: json.userId,
    name: json.name,
    email: json.email,
    workspaces,
  }
}

export class CloudAuth {
  private state: CloudAuthState = {
    status: `signed-out`,
    email: null,
    name: null,
    userId: null,
    workspaces: null,
    error: null,
  }
  private listeners = new Set<(state: CloudAuthState) => void>()
  private activeFlow: { state: string; provider: CloudAuthProvider } | null =
    null
  private activeWindow: BrowserWindow | null = null

  constructor(private readonly secretStore: SecretStore) {}

  /**
   * Hydrate state from the encrypted secret store on app launch. Treats
   * an expired JWT as signed-out so the UI doesn't claim a stale
   * session — the user will need to re-authorize anyway. We don't
   * actively call whoami here; the token is good enough to display the
   * email until it actually fails on a real API call.
   */
  async initialize(): Promise<void> {
    const stored = await this.loadStored()
    if (!stored) return
    if (this.isExpired(stored.expiresAt)) {
      await this.secretStore.delete(SECRET_REF)
      return
    }
    // Optimistically mark signed-in from the stored email so the UI
    // doesn't flicker through "signed-out" while we hit `auth.whoami`
    // to refresh name + workspaces. If whoami later reports unauthorized,
    // `refreshWhoami` will sign us out.
    this.setState({
      status: `signed-in`,
      email: stored.email,
      name: null,
      userId: null,
      workspaces: null,
      error: null,
    })
    await this.refreshWhoami(stored.token)
  }

  getState(): CloudAuthState {
    return this.state
  }

  /** JWT bearer token for outbound admin-API calls. `null` when signed out. */
  async getToken(): Promise<string | null> {
    if (this.state.status !== `signed-in`) return null
    const stored = await this.loadStored()
    if (!stored || this.isExpired(stored.expiresAt)) return null
    return stored.token
  }

  subscribe(listener: (state: CloudAuthState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async signOut(): Promise<void> {
    await this.secretStore.delete(SECRET_REF)
    this.cancelActiveFlow()
    this.setState({
      status: `signed-out`,
      email: null,
      name: null,
      userId: null,
      workspaces: null,
      error: null,
    })
  }

  /**
   * Open the Electric Cloud dashboard for the signed-in user in the
   * system browser. No-op when signed out — the dashboard would just
   * bounce back to the login screen anyway.
   */
  openDashboard(): void {
    if (this.state.status !== `signed-in`) return
    void shell.openExternal(getCloudBaseUrl())
  }

  openCreateAgentsServer(): void {
    const url = new URL(`/`, getCloudBaseUrl())
    url.searchParams.set(`intent`, `create`)
    url.searchParams.set(`serviceType`, `streams`)
    url.searchParams.set(`variant`, `agent-streams`)
    void shell.openExternal(url.toString())
  }

  /**
   * Open the OAuth flow for `provider` in a new BrowserWindow. Resolves
   * when the user completes (or cancels) the flow.
   *
   * Calling this while a previous flow is open replaces the previous
   * window — supports the user clicking "Sign in with GitHub" then
   * switching to Google without first closing the original popup.
   */
  async signIn(
    provider: CloudAuthProvider,
    parent?: BrowserWindow | undefined
  ): Promise<void> {
    this.cancelActiveFlow()
    const stateNonce = randomUUID()
    const flow = { state: stateNonce, provider }
    this.activeFlow = flow
    this.setState({
      status: `signing-in`,
      email: this.state.email,
      name: this.state.name,
      userId: this.state.userId,
      workspaces: this.state.workspaces,
      error: null,
    })

    const win = new BrowserWindow({
      width: 520,
      height: 720,
      title: `Sign in to Electric Cloud`,
      parent,
      modal: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    this.activeWindow = win

    const prefix = loopbackPrefix()
    let settled = false

    const settle = async (
      result:
        | {
            ok: true
            payload: CloudAuthSecret
          }
        | { ok: false; error: string | null }
    ) => {
      if (settled) return
      settled = true
      if (this.activeFlow !== flow) {
        if (this.activeWindow === win) this.activeWindow = null
        return
      }
      this.activeFlow = null
      // Close after the current event tick so we don't race with
      // Electron's own teardown when settling from inside a navigation
      // listener.
      setImmediate(() => {
        if (!win.isDestroyed()) win.close()
      })
      if (this.activeWindow === win) this.activeWindow = null

      if (!result.ok) {
        // `null` error means user cancelled — return to the last
        // known good state rather than surfacing an error banner.
        if (result.error === null) {
          this.setState({
            status: this.state.email ? `signed-in` : `signed-out`,
            email: this.state.email,
            name: this.state.name,
            userId: this.state.userId,
            workspaces: this.state.workspaces,
            error: null,
          })
        } else {
          this.setState({
            status: `error`,
            email: this.state.email,
            name: this.state.name,
            userId: this.state.userId,
            workspaces: this.state.workspaces,
            error: result.error,
          })
        }
        return
      }

      await this.secretStore.set(SECRET_REF, JSON.stringify(result.payload))
      this.setState({
        status: `signed-in`,
        email: result.payload.email,
        name: null,
        userId: null,
        workspaces: null,
        error: null,
      })
      // Fetch the user's name + workspaces in the background — the panel
      // will rerender as soon as the response lands. Failure here is
      // non-fatal (we still have a valid JWT and email).
      void this.refreshWhoami(result.payload.token)
    }

    const tryIntercept = (rawUrl: string): boolean => {
      if (!rawUrl.startsWith(prefix)) return false
      try {
        const url = new URL(rawUrl)
        const token = url.searchParams.get(`token`)
        const state = url.searchParams.get(`state`)
        const email = url.searchParams.get(`email`)
        const expiresAt = url.searchParams.get(`expiresAt`)
        if (!token || !state || !email || !expiresAt) {
          void settle({ ok: false, error: `Missing fields in callback URL` })
          return true
        }
        if (state !== stateNonce) {
          void settle({ ok: false, error: `OAuth state mismatch` })
          return true
        }
        void settle({
          ok: true,
          payload: { token, email, expiresAt, provider },
        })
        return true
      } catch {
        return false
      }
    }

    win.webContents.on(`will-redirect`, (event, url) => {
      if (tryIntercept(url)) event.preventDefault()
    })
    win.webContents.on(`will-navigate`, (event, url) => {
      if (tryIntercept(url)) event.preventDefault()
    })
    win.on(`closed`, () => {
      // Treat manual window close as cancellation.
      void settle({ ok: false, error: null })
    })

    try {
      await win.loadURL(authorizeUrl(provider, stateNonce))
    } catch (err) {
      void settle({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Hit `auth.whoami` on the admin-API to refresh the cached profile
   * (name + workspaces). Treats HTTP 401/403 as a hard sign-out (token
   * was revoked or expired server-side); other failures are swallowed
   * so a transient network blip doesn't drop the session.
   *
   * The wire format mirrors what `@orpc/client`'s `RPCLink` v1.13.x
   * sends: `POST {baseUrl}/api/rpc/auth/whoami` with body
   * `{"json":{}}`. The response is `{ json: <result>, meta?: [...] }`;
   * we extract `.json`. The contract has no special types in the
   * result, so we ignore `meta`.
   */
  private async refreshWhoami(token: string): Promise<void> {
    const url = new URL(`/api/rpc/auth/whoami`, getCloudBaseUrl())
    let res: Response
    try {
      res = await fetch(url, {
        method: `POST`,
        headers: {
          'content-type': `application/json`,
          authorization: `Bearer ${token}`,
        },
        body: `{"json":{}}`,
      })
    } catch (err) {
      console.warn(`[agents-desktop] cloud-auth: whoami fetch failed:`, err)
      return
    }
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[agents-desktop] cloud-auth: whoami returned ${res.status}; signing out`
      )
      await this.signOut()
      return
    }
    if (!res.ok) {
      console.warn(
        `[agents-desktop] cloud-auth: whoami returned ${res.status} ${res.statusText}`
      )
      return
    }
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      console.warn(`[agents-desktop] cloud-auth: whoami body parse:`, err)
      return
    }
    const result = parseWhoamiUserResponse(body)
    if (!result) {
      // Either an API-token response (we're using user auth) or a
      // shape mismatch — surface nothing rather than display stale info.
      return
    }
    // Only update if we're still signed in — guards against a race
    // where the user clicks "Sign out" while the fetch was in flight.
    if (this.state.status !== `signed-in`) return
    this.setState({
      status: `signed-in`,
      email: result.email,
      name: result.name,
      userId: result.userId,
      workspaces: result.workspaces,
      error: null,
    })
  }

  private cancelActiveFlow(): void {
    const win = this.activeWindow
    if (win && !win.isDestroyed()) {
      // We intentionally clear the flow before closing so the `closed`
      // listener doesn't re-enter `settle` with a stale state nonce.
      this.activeFlow = null
      this.activeWindow = null
      win.close()
    }
  }

  private async loadStored(): Promise<CloudAuthSecret | null> {
    const raw = await this.secretStore.get(SECRET_REF)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<CloudAuthSecret>
      if (
        typeof parsed.token !== `string` ||
        typeof parsed.email !== `string` ||
        typeof parsed.expiresAt !== `string` ||
        (parsed.provider !== `github` && parsed.provider !== `google`)
      ) {
        return null
      }
      return {
        token: parsed.token,
        email: parsed.email,
        expiresAt: parsed.expiresAt,
        provider: parsed.provider,
      }
    } catch {
      return null
    }
  }

  private isExpired(expiresAt: string): boolean {
    const ts = Date.parse(expiresAt)
    if (Number.isNaN(ts)) return true
    return ts < Date.now()
  }

  private setState(next: CloudAuthState): void {
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch (err) {
        console.warn(`[agents-desktop] cloud-auth listener threw:`, err)
      }
    }
  }
}
