import { createServer, type Server } from 'node:http'
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { McpServerConfig } from '../types.js'
import type { TokenStore } from './token-store.js'

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000 // 5 minutes

export interface OAuthProviderOptions {
  serverName: string
  serverConfig: McpServerConfig
  tokenStore: TokenStore
  onAuthUrl?: (url: string) => void
}

/**
 * OAuthClientProvider backed by TokenStore for persistent credential storage.
 *
 * When authorization is required the provider spins up a temporary HTTP server
 * on a local port, prints (or calls back with) the authorization URL, and
 * waits up to 5 minutes for the redirect callback carrying the auth code.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  private readonly serverName: string
  private readonly serverConfig: McpServerConfig
  private readonly tokenStore: TokenStore
  private readonly onAuthUrl?: (url: string) => void
  private readonly callbackPort: number
  private authCodeResolve?: (code: string) => void

  constructor(opts: OAuthProviderOptions) {
    this.serverName = opts.serverName
    this.serverConfig = opts.serverConfig
    this.tokenStore = opts.tokenStore
    this.onAuthUrl = opts.onAuthUrl
    this.callbackPort = opts.serverConfig.oauth?.callbackPort ?? 0
  }

  // ── redirect URL ────────────────────────────────────────────

  get redirectUrl(): string {
    // The actual port may differ (when callbackPort is 0 the OS picks a random
    // port), but the SDK calls this *before* the redirect so we return a
    // template that matches what we will listen on. The port is patched inside
    // `redirectToAuthorization` once the server is actually listening.
    const port = this.callbackPort || 9876
    return `http://127.0.0.1:${String(port)}/oauth/callback`
  }

  // ── client metadata ─────────────────────────────────────────

  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      redirect_uris: [this.redirectUrl],
      client_name: `electric-agents (${this.serverName})`,
      grant_types: [`authorization_code`, `refresh_token`],
      response_types: [`code`],
      token_endpoint_auth_method: `none`,
    }

    if (this.serverConfig.oauth?.scopes?.length) {
      meta.scope = this.serverConfig.oauth.scopes.join(` `)
    }

    return meta
  }

  // ── client information (DCR) ────────────────────────────────

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const info = this.tokenStore.getClientInfo(this.serverName)
    if (!info) return undefined
    return info as unknown as OAuthClientInformationMixed
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed
  ): Promise<void> {
    this.tokenStore.saveClientInfo(
      this.serverName,
      clientInformation as unknown as Record<string, unknown>
    )
  }

  // ── tokens ──────────────────────────────────────────────────

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = this.tokenStore.getTokens(this.serverName)
    if (!stored) return undefined
    return {
      access_token: stored.access_token,
      token_type: stored.token_type,
      refresh_token: stored.refresh_token,
      expires_in: stored.expires_at
        ? Math.max(0, Math.floor((stored.expires_at - Date.now()) / 1_000))
        : undefined,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.tokenStore.saveTokens(this.serverName, {
      access_token: tokens.access_token,
      token_type: `Bearer`,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1_000
        : undefined,
    })
  }

  // ── code verifier (PKCE) ────────────────────────────────────

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.tokenStore.saveCodeVerifier(this.serverName, codeVerifier)
  }

  async codeVerifier(): Promise<string> {
    const v = this.tokenStore.getCodeVerifier(this.serverName)
    if (!v)
      throw new Error(`No PKCE code verifier stored for ${this.serverName}`)
    return v
  }

  // ── redirect to authorization ───────────────────────────────

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const code = await this.waitForAuthCode(authorizationUrl)
    // The SDK drives the token exchange after we return; we just need to
    // make sure it has the auth code. Unfortunately the SDK's `auth()`
    // orchestrator handles the exchange itself when called with the code,
    // so we store a pending code that callers can retrieve.
    this.authCodeResolve?.(code)
  }

  /**
   * Starts a temporary HTTP server, prints the auth URL (or calls the
   * `onAuthUrl` callback), and waits for the OAuth redirect to arrive.
   * Returns the authorization code extracted from the callback.
   */
  private waitForAuthCode(authorizationUrl: URL): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let server: Server | undefined

      const cleanup = () => {
        try {
          server?.close()
        } catch {
          // ignore
        }
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `OAuth callback timed out after ${String(CALLBACK_TIMEOUT_MS / 1_000)}s`
          )
        )
      }, CALLBACK_TIMEOUT_MS)

      server = createServer((req, res) => {
        const url = new URL(req.url ?? `/`, `http://127.0.0.1`)
        if (!url.pathname.endsWith(`/oauth/callback`)) {
          res.writeHead(404)
          res.end(`Not found`)
          return
        }

        const code = url.searchParams.get(`code`)
        const error = url.searchParams.get(`error`)

        if (error) {
          const desc = url.searchParams.get(`error_description`) ?? error
          res.writeHead(200, { 'Content-Type': `text/html` })
          res.end(
            `<html><body><h2>Authorization failed</h2><p>${desc}</p></body></html>`
          )
          clearTimeout(timeout)
          cleanup()
          reject(new Error(`OAuth authorization failed: ${desc}`))
          return
        }

        if (!code) {
          res.writeHead(400)
          res.end(`Missing authorization code`)
          return
        }

        res.writeHead(200, { 'Content-Type': `text/html` })
        res.end(
          `<html><body><h2>Authorization successful</h2><p>You can close this tab.</p></body></html>`
        )
        clearTimeout(timeout)
        cleanup()
        resolve(code)
      })

      server.listen(this.callbackPort, `127.0.0.1`, () => {
        const addr = server!.address()
        if (typeof addr === `object` && addr) {
          // Patch the actual redirect URL into the authorization URL in case
          // the port was auto-assigned (callbackPort === 0).
          const actualPort = addr.port
          const actualRedirect = `http://127.0.0.1:${String(actualPort)}/oauth/callback`
          authorizationUrl.searchParams.set(`redirect_uri`, actualRedirect)
        }

        const urlStr = authorizationUrl.toString()
        if (this.onAuthUrl) {
          this.onAuthUrl(urlStr)
        } else {
          console.log(
            `\nOpen this URL to authorize MCP server "${this.serverName}":\n${urlStr}\n`
          )
        }
      })

      server.on(`error`, (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  // ── discovery state (optional persistence) ──────────────────

  async saveDiscoveryState(_state: OAuthDiscoveryState): Promise<void> {
    // Discovery state is not persisted in this implementation; the SDK
    // will re-discover on each new session.
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return undefined
  }
}
