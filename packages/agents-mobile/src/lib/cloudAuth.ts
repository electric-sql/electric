import AsyncStorage from '@react-native-async-storage/async-storage'
import * as WebBrowser from 'expo-web-browser'

/**
 * Electric Cloud sign-in for the mobile app.
 *
 * Uses the admin-API's native-redirect flow: the OAuth page opens
 * inside an `ASWebAuthenticationSession` (iOS) / Chrome Custom Tab
 * (Android) via `expo-web-browser`, and the dashboard redirects to
 * `electric-agents://oauth/callback?token=…` once the user has signed
 * in. The system browser surfaces that deep link to us via the
 * `openAuthSessionAsync` result and the session dismisses itself.
 *
 * Why the custom scheme rather than the desktop / CLI's loopback HTTP
 * URL: Google's "Use Secure Browsers" policy blocks OAuth from
 * embedded `WebView`s, so the mobile flow has to run inside a real
 * system browser (which is what `openAuthSessionAsync` opens). A real
 * browser won't tunnel back to a local loopback port the app is
 * listening on, so the redirect has to terminate in a deep link the
 * OS routes back to us. The desktop / CLI path keeps using the
 * loopback URL; the admin-API picks per-request based on which query
 * param the client sent.
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

/**
 * Native-app redirect scheme registered on the admin-API allowlist.
 * Must match the `scheme` declared in `app.json` so the OS routes the
 * dashboard's redirect back to this app. The admin-API rejects any
 * other value at the login endpoint.
 */
export const CLOUD_AUTH_REDIRECT_SCHEME = `electric-agents`
export const CLOUD_AUTH_REDIRECT_URI = `${CLOUD_AUTH_REDIRECT_SCHEME}://oauth/callback`

const PROD_DASHBOARD_URL = `https://dashboard.electric-sql.cloud`

export function getCloudBaseUrl(): string {
  // `process.env.EXPO_PUBLIC_*` is inlined at bundle time by Metro —
  // same override knob the rest of the Expo ecosystem uses to point at
  // a dev/staging admin-API.
  const fromEnv = process.env.EXPO_PUBLIC_ELECTRIC_DASHBOARD_URL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : PROD_DASHBOARD_URL
}

function buildAuthorizeUrl(
  provider: CloudAuthProvider,
  cliState: string
): string {
  const url = new URL(`/api/public/auth/${provider}/login`, getCloudBaseUrl())
  url.searchParams.set(`cli_redirect_scheme`, CLOUD_AUTH_REDIRECT_SCHEME)
  url.searchParams.set(`cli_state`, cliState)
  return url.toString()
}

type CloudAuthCallbackResult = {
  token: string
  state: string
  email: string
  expiresAt: string
  provider: CloudAuthProvider
}

function parseCallbackUrl(
  url: string,
  provider: CloudAuthProvider
): CloudAuthCallbackResult | null {
  if (!url.startsWith(CLOUD_AUTH_REDIRECT_URI)) return null
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
 * The class isn't a React hook — instead the `CloudAuthContext` wraps
 * it so any component can subscribe via `useCloudAuth()` without
 * re-instantiating storage / network on every render.
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
   * Run the OAuth flow end-to-end: open the system browser sheet,
   * wait for the dashboard's deep-link redirect, validate the CSRF
   * state nonce, persist the JWT, kick off a `whoami` refresh.
   *
   * Returns silently on cancellation (user backed out of the sheet) —
   * the UI just falls back to whatever the previous state was.
   * Failures are surfaced through `setState({ status: 'error' })`.
   */
  async signIn(provider: CloudAuthProvider): Promise<void> {
    const previous = this.state
    this.setState({
      ...previous,
      status: `signing-in`,
      error: null,
    })

    const cliState = generateState()
    const authorizeUrl = buildAuthorizeUrl(provider, cliState)

    let result: WebBrowser.WebBrowserAuthSessionResult
    try {
      result = await WebBrowser.openAuthSessionAsync(
        authorizeUrl,
        CLOUD_AUTH_REDIRECT_URI,
        {
          // ASWebAuthenticationSession by default shares cookies with
          // Safari (iOS) / the system browser (Android) — leaving that
          // on means a user already signed into GitHub or Google in
          // their phone's browser skips the password prompt.
          preferEphemeralSession: false,
        }
      )
    } catch (err) {
      this.setState({
        ...previous,
        status: `error`,
        error: err instanceof Error ? err.message : String(err),
      })
      return
    }

    if (result.type !== `success` || !result.url) {
      // `cancel`, `dismiss`, `locked`, or no URL — return to prior state.
      this.setState({
        ...previous,
        status: previous.email ? `signed-in` : `signed-out`,
        error: null,
      })
      return
    }

    const parsed = parseCallbackUrl(result.url, provider)
    if (!parsed) {
      this.setState({
        ...previous,
        status: `error`,
        error: `Sign-in callback was missing required fields.`,
      })
      return
    }
    if (parsed.state !== cliState) {
      this.setState({
        ...previous,
        status: `error`,
        error: `Sign-in state mismatch — please try again.`,
      })
      return
    }

    const stored: StoredAuth = {
      token: parsed.token,
      email: parsed.email,
      expiresAt: parsed.expiresAt,
      provider: parsed.provider,
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    this.setState({
      status: `signed-in`,
      email: parsed.email,
      name: null,
      userId: null,
      workspaces: null,
      error: null,
    })
    void this.refreshWhoami(parsed.token)
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

/**
 * Random CSRF nonce. The dashboard echoes it back via the redirect
 * URL, and `signIn` rejects the callback if the value doesn't match
 * what we sent.
 *
 * Prefers `crypto.randomUUID()` (polyfilled at app boot via
 * `react-native-random-uuid`) but falls back to a `Math.random`-based
 * UUID so the auth flow keeps working if the polyfill ever stops
 * loading early enough — the value isn't a secret, just a uniqueness
 * marker.
 */
function generateState(): string {
  if (
    typeof crypto !== `undefined` &&
    typeof crypto.randomUUID === `function`
  ) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// One instance shared across the app — the React context just wraps it.
export const cloudAuth = new CloudAuth()
