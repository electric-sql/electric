import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Electric Cloud sign-in for the mobile app.
 *
 * Mirrors the desktop flow (`packages/agents-desktop/src/cloud-auth.ts`)
 * over the same backend endpoints — the only thing that differs is the
 * vehicle that opens the OAuth page and intercepts the loopback redirect:
 *
 *   - desktop: a sandboxed `BrowserWindow` + `webContents.will-redirect`
 *   - mobile:  a full-screen `<WebView>` + `onShouldStartLoadWithRequest`
 *
 * Both flows ask the admin-API to redirect to
 * `http://127.0.0.1:53118/callback?token=…` after the user signs in.
 * Nothing actually listens on that port — the WebView cancels the
 * navigation by URL prefix before any request goes out, and we pull
 * `token`, `state`, `email`, `expiresAt` off the URL.
 *
 * The JWT is persisted in AsyncStorage. We'd prefer the OS keychain
 * (`expo-secure-store`) here, but staying within the deps the mobile
 * package already ships avoids new native modules; storage is sandboxed
 * per-app on iOS/Android either way.
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

export type CloudAuthCallbackResult = {
  token: string
  state: string
  email: string
  expiresAt: string
  provider: CloudAuthProvider
}

type StoredAuth = {
  token: string
  email: string
  expiresAt: string
  provider: CloudAuthProvider
}

type WhoamiUserResponse = {
  type: `user`
  userId: string
  name: string
  email: string
  workspaces: ReadonlyArray<CloudAuthWorkspace>
}

const STORAGE_KEY = `electric-agents-mobile.cloud-auth`

// Stable loopback "port" threaded through the OAuth flow as `cli_port`.
// Nothing listens on this port — the WebView cancels the navigation by
// URL prefix before any request goes out. Picked to match the desktop
// app so a single backend redirect target serves both clients.
export const CLOUD_AUTH_CLI_PORT = 53118
export const CLOUD_AUTH_REDIRECT_PREFIX = `http://127.0.0.1:${CLOUD_AUTH_CLI_PORT}/callback`

const PROD_DASHBOARD_URL = `https://dashboard.electric-sql.cloud`

export function getCloudBaseUrl(): string {
  // `process.env.EXPO_PUBLIC_*` is inlined at bundle time by Metro — same
  // override knob the rest of the Expo ecosystem uses to point at a
  // dev/staging admin-API.
  const fromEnv = process.env.EXPO_PUBLIC_ELECTRIC_DASHBOARD_URL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : PROD_DASHBOARD_URL
}

export function buildAuthorizeUrl(
  provider: CloudAuthProvider,
  cliState: string
): string {
  const url = new URL(`/api/public/auth/${provider}/login`, getCloudBaseUrl())
  url.searchParams.set(`cli_port`, String(CLOUD_AUTH_CLI_PORT))
  url.searchParams.set(`cli_state`, cliState)
  return url.toString()
}

/**
 * Parse a `http://127.0.0.1:53118/callback?token=…` URL into a typed
 * callback result. Returns `null` for any URL that doesn't match the
 * expected redirect prefix or is missing required query params.
 */
export function parseCallbackUrl(
  url: string,
  provider: CloudAuthProvider
): CloudAuthCallbackResult | null {
  if (!url.startsWith(CLOUD_AUTH_REDIRECT_PREFIX)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const token = parsed.searchParams.get(`token`)
  const state = parsed.searchParams.get(`state`)
  const email = parsed.searchParams.get(`email`)
  const expiresAt = parsed.searchParams.get(`expiresAt`)
  if (!token || !state || !email || !expiresAt) return null
  return { token, state, email, expiresAt, provider }
}

function parseWhoamiUserResponse(body: unknown): WhoamiUserResponse | null {
  if (!body || typeof body !== `object`) return null
  // The oRPC RPC response wraps the result as `{ json, meta? }`. Some
  // legacy ad-hoc handlers might return it un-wrapped, so accept both.
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

function isExpired(expiresAtIso: string): boolean {
  const ts = Date.parse(expiresAtIso)
  if (Number.isNaN(ts)) return false
  return ts < Date.now()
}

/**
 * Singleton state machine that owns the cloud-auth session.
 *
 * The class isn't a React hook — instead the
 * `CloudAuthContext` wraps it so any component can subscribe via
 * `useCloudAuth()` without re-instantiating storage / network on every
 * render.
 */
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
  private initialized = false

  getState(): CloudAuthState {
    return this.state
  }

  subscribe(listener: (state: CloudAuthState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Hydrate from `AsyncStorage` on first app launch. Discards an expired
   * session rather than claiming the user is signed in — they'll need
   * to re-authorize on the next attempt. Subsequently kicks off a
   * `whoami` refresh to repopulate name + workspaces; the panel doesn't
   * flicker through "signed-out" because we optimistically mark
   * `signed-in` from the stored email first.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    const stored = await this.loadStored()
    if (!stored) return
    if (isExpired(stored.expiresAt)) {
      await AsyncStorage.removeItem(STORAGE_KEY)
      return
    }
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

  /**
   * Start a new sign-in flow. Transitions to `signing-in` so the
   * caller (the WebView screen) can render its loading state. The
   * actual OAuth dance and redirect interception happen in the
   * `<SignInWebView>` component; it invokes `completeSignIn` with the
   * captured token on success.
   */
  beginSignIn(_provider: CloudAuthProvider): void {
    void _provider
    this.setState({
      ...this.state,
      status: `signing-in`,
      error: null,
    })
  }

  /**
   * Cancel an in-progress sign-in (user backed out of the WebView).
   * Returns to the prior signed-in/signed-out state without an error
   * banner — that's reserved for actual failures.
   */
  cancelSignIn(): void {
    if (this.state.status !== `signing-in`) return
    this.setState({
      ...this.state,
      status: this.state.email ? `signed-in` : `signed-out`,
      error: null,
    })
  }

  /** Surface an unrecoverable error from the sign-in flow. */
  reportSignInError(message: string): void {
    this.setState({
      ...this.state,
      status: `error`,
      error: message,
    })
  }

  /**
   * Persist the credential captured from the loopback redirect and
   * flip into `signed-in`. Kicks off a background `whoami` refresh —
   * we already have `email`, name/workspaces fill in shortly after.
   */
  async completeSignIn(result: CloudAuthCallbackResult): Promise<void> {
    const stored: StoredAuth = {
      token: result.token,
      email: result.email,
      expiresAt: result.expiresAt,
      provider: result.provider,
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    this.setState({
      status: `signed-in`,
      email: result.email,
      name: null,
      userId: null,
      workspaces: null,
      error: null,
    })
    void this.refreshWhoami(result.token)
  }

  async signOut(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY)
    this.setState({
      status: `signed-out`,
      email: null,
      name: null,
      userId: null,
      workspaces: null,
      error: null,
    })
  }

  /** JWT bearer token for outbound admin-API calls. `null` when signed out. */
  async getToken(): Promise<string | null> {
    if (this.state.status !== `signed-in`) return null
    const stored = await this.loadStored()
    if (!stored || isExpired(stored.expiresAt)) return null
    return stored.token
  }

  /**
   * Hit `auth.whoami` on the admin-API to refresh the cached profile
   * (name + workspaces). Treats 401/403 as a hard sign-out (token was
   * revoked or expired server-side); other failures are swallowed so a
   * transient network blip doesn't drop the session.
   */
  private async refreshWhoami(token: string): Promise<void> {
    const url = `${getCloudBaseUrl()}/api/rpc/auth/whoami`
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
      console.warn(`[agents-mobile] cloud-auth: whoami fetch failed:`, err)
      return
    }
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[agents-mobile] cloud-auth: whoami returned ${res.status}; signing out`
      )
      await this.signOut()
      return
    }
    if (!res.ok) {
      console.warn(`[agents-mobile] cloud-auth: whoami returned ${res.status}`)
      return
    }
    let body: unknown
    try {
      body = await res.json()
    } catch (err) {
      console.warn(`[agents-mobile] cloud-auth: whoami body parse:`, err)
      return
    }
    const result = parseWhoamiUserResponse(body)
    if (!result) return
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

  private async loadStored(): Promise<StoredAuth | null> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<StoredAuth>
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

  private setState(next: CloudAuthState): void {
    this.state = next
    for (const listener of this.listeners) {
      try {
        listener(next)
      } catch (err) {
        console.warn(`[agents-mobile] cloud-auth listener threw:`, err)
      }
    }
  }
}

// One instance shared across the app — the React context just wraps it.
export const cloudAuth = new CloudAuth()
