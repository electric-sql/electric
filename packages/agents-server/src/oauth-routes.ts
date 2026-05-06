import {
  exchangeAuthorizationCode,
  type OAuthCoordinator,
  type PendingAuthStore,
} from '@electric-ax/agents-mcp'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Dependencies needed by the OAuth callback route.
 *
 * The pending-auth store holds the per-flow PKCE/state context that was
 * generated when the authorization URL was built. The coordinator is the
 * same instance the MCP registry consults when minting bearer tokens — by
 * setting the freshly-exchanged token on it here we hand the credential off
 * to the live registry without re-reading from disk.
 */
export interface OAuthRouteDeps {
  pending: PendingAuthStore
  coordinator: OAuthCoordinator
}

export interface OAuthCallbackParams {
  server: string
  code: string
  state: string
}

export interface OAuthCallbackResult {
  status: number
  body: string
  contentType?: string
}

/**
 * Pure handler for the OAuth browser-redirect callback.
 *
 * Returns a `{ status, body }` triple suitable for any HTTP framework. The
 * route binding (e.g. `mountOAuthRoutes` for native node http) just translates
 * this into the framework's response shape.
 *
 * Flow:
 *   1. Validate `code` + `state` are present.
 *   2. Consume the matching pending-auth entry (state is single-use).
 *   3. Exchange the authorization code for a token set.
 *   4. Stash the tokens in the coordinator's cache so subsequent MCP tool
 *      calls find a valid bearer token without another browser round-trip.
 */
export async function handleOAuthCallback(
  deps: OAuthRouteDeps,
  params: OAuthCallbackParams
): Promise<OAuthCallbackResult> {
  const { code, state } = params
  if (!code || !state) {
    return { status: 400, body: `missing code or state` }
  }
  const pending = deps.pending.consume(state)
  if (!pending) {
    return { status: 400, body: `unknown state` }
  }
  try {
    const tokens = await exchangeAuthorizationCode({
      tokenUrl: pending.tokenUrl,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      code,
      verifier: pending.verifier,
    })
    deps.coordinator.setToken(pending.server, undefined, tokens)
    return {
      status: 200,
      body: `Authorization complete. You can close this window.`,
      contentType: `text/plain; charset=utf-8`,
    }
  } catch (err) {
    return {
      status: 500,
      body: `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Match `GET /oauth/callback/:server` paths.
 *
 * Returns the captured `server` segment, or `null` if the path is not an
 * OAuth callback. We accept any non-empty trailing segment; further
 * validation (e.g. registered server name) belongs in the coordinator.
 */
export function matchOAuthCallbackPath(
  path: string
): { server: string } | null {
  const prefix = `/oauth/callback/`
  if (!path.startsWith(prefix)) return null
  const rest = path.slice(prefix.length)
  if (!rest || rest.includes(`/`)) return null
  return { server: decodeURIComponent(rest) }
}

/**
 * Native-node HTTP request handler for the OAuth callback.
 *
 * Returns `true` if the request was handled (so the caller can short-circuit
 * its routing chain), `false` otherwise. This is the integration point used
 * by `server.ts`/`bootstrap.ts` once those start passing the deps in.
 */
export async function handleOAuthCallbackRequest(
  deps: OAuthRouteDeps,
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  if (req.method?.toUpperCase() !== `GET`) return false
  const url = new URL(req.url ?? `/`, `http://localhost`)
  const match = matchOAuthCallbackPath(url.pathname)
  if (!match) return false

  const code = url.searchParams.get(`code`) ?? ``
  const state = url.searchParams.get(`state`) ?? ``
  const result = await handleOAuthCallback(deps, {
    server: match.server,
    code,
    state,
  })
  res.writeHead(result.status, {
    'content-type': result.contentType ?? `text/plain; charset=utf-8`,
  })
  res.end(result.body)
  return true
}

/**
 * Server-agnostic mount point.
 *
 * The agents-server uses native node http (no router instance), so for
 * symmetry with the rest of `server.ts` we expose a registration function
 * that wires `handleOAuthCallbackRequest` into the request dispatch chain.
 *
 * The wiring (passing `deps` from agents/bootstrap) is deferred to a later
 * task; `server.ts` does not call this yet.
 */
export interface OAuthRouteMount {
  /**
   * Try to handle an incoming request as an OAuth callback. Returns `true`
   * when the request was an OAuth callback (and a response was written),
   * `false` otherwise.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
}

export function mountOAuthRoutes(deps: OAuthRouteDeps): OAuthRouteMount {
  return {
    handle: (req, res) => handleOAuthCallbackRequest(deps, req, res),
  }
}
