import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  type KeyVault,
  type OAuthCoordinator,
  type PendingAuthStore,
  type Registry,
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

/**
 * Optional dependencies for the "Option B" registry-lookup variant of the
 * authorize endpoint.
 *
 * When the UI calls `POST /api/mcp/servers/:server/authorize` with an empty
 * body, the route binding can use these to look up the OAuth config from
 * the registry/vault rather than requiring the UI to ship every field.
 *
 * `defaultRedirectUri` is a callback URL for this agents-server instance
 * (e.g. `http://localhost:4437/oauth/callback/<server>`); the server
 * substitutes the `<server>` placeholder, or appends `/<server>` if no
 * placeholder is present.
 */
export interface OAuthInitiateLookupDeps {
  registry: Registry
  vault: KeyVault
  defaultRedirectUri: string
}

export function mountOAuthRoutes(
  deps: OAuthRouteDeps,
  lookup?: OAuthInitiateLookupDeps
): OAuthRouteMount {
  return {
    handle: async (req, res) => {
      if (await handleOAuthInitiateRequest(deps, req, res, lookup)) return true
      return handleOAuthCallbackRequest(deps, req, res)
    },
  }
}

/**
 * Parameters for the authorization-code initiate endpoint.
 *
 * The `server` is taken from the URL path (`/api/mcp/servers/:server/authorize`);
 * the rest are supplied in the request body. We capture `tokenUrl` here so that
 * later, when the browser redirect comes back to `/oauth/callback/:server`, we
 * can complete the code exchange without re-loading server config.
 */
export interface OAuthInitiateParams {
  server: string
  authorizationUrl: string
  tokenUrl: string
  clientId: string
  redirectUri: string
  scopes?: string[]
}

export interface OAuthInitiateResult {
  status: 200 | 400
  body: { url: string } | { error: string }
}

/**
 * Pure handler for `POST /api/mcp/servers/:server/authorize`.
 *
 * Builds an authorization URL (with PKCE + a fresh `state`), stashes the
 * per-flow context in the pending-auth store keyed by that `state`, and
 * returns the URL for the caller (UI or curl) to redirect the user to.
 */
export async function handleOAuthInitiate(
  deps: { pending: PendingAuthStore },
  params: OAuthInitiateParams
): Promise<OAuthInitiateResult> {
  if (
    !params.server ||
    !params.authorizationUrl ||
    !params.tokenUrl ||
    !params.clientId ||
    !params.redirectUri
  ) {
    return { status: 400, body: { error: `missing required fields` } }
  }
  const { url, state, verifier } = buildAuthorizationUrl({
    authorizationUrl: params.authorizationUrl,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
  })
  deps.pending.put({
    state,
    server: params.server,
    verifier,
    clientId: params.clientId,
    tokenUrl: params.tokenUrl,
    redirectUri: params.redirectUri,
  })
  return { status: 200, body: { url } }
}

/**
 * Match `POST /api/mcp/servers/:server/authorize` paths.
 */
export function matchOAuthInitiatePath(
  path: string
): { server: string } | null {
  const m = path.match(/^\/api\/mcp\/servers\/([^/]+)\/authorize$/)
  return m ? { server: decodeURIComponent(m[1]) } : null
}

/**
 * Read the entire request body as a UTF-8 string. Bounded by the request
 * stream's natural backpressure; callers should impose their own size limit
 * if untrusted clients can hit this endpoint.
 */
async function readJsonBody(req: IncomingMessage): Promise<string> {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === `string` ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString(`utf-8`)
}

/**
 * Resolve the OAuth initiate params for `server` from the registry+vault.
 *
 * Used by the Option-B path of {@link handleOAuthInitiateRequest}: when the
 * UI hits the authorize endpoint with an empty body, we don't expect it to
 * know the OAuth URLs/clientId — those live in `mcp.json` and the vault.
 *
 * Returns `null` when the server isn't registered, isn't HTTP, isn't using
 * `authorizationCode` mode, or is missing required config (e.g. no
 * `authorizationUrl`). The caller turns that into a 400.
 */
export async function resolveOAuthInitiateParams(
  lookup: OAuthInitiateLookupDeps,
  server: string
): Promise<OAuthInitiateParams | null> {
  const entry = lookup.registry.get(server)
  if (!entry) return null
  if (entry.config.transport !== `http`) return null
  const auth = entry.config.auth
  if (auth.mode !== `authorizationCode`) return null
  if (!auth.authorizationUrl || !auth.tokenUrl || !auth.clientIdRef) return null
  const clientId = await lookup.vault.get(auth.clientIdRef)
  if (!clientId) return null
  // Substitute `<server>` if present, else append the server name.
  const redirectUri = lookup.defaultRedirectUri.includes(`<server>`)
    ? lookup.defaultRedirectUri.replace(`<server>`, encodeURIComponent(server))
    : `${lookup.defaultRedirectUri.replace(/\/$/, ``)}/${encodeURIComponent(server)}`
  return {
    server,
    authorizationUrl: auth.authorizationUrl,
    tokenUrl: auth.tokenUrl,
    clientId,
    redirectUri,
    scopes: auth.scopes,
  }
}

/**
 * Native-node HTTP request handler for the OAuth initiate endpoint.
 *
 * Returns `true` if the request was handled (the response has been written),
 * `false` otherwise. Mirrors `handleOAuthCallbackRequest`'s shape so both can
 * be wired through the same `mountOAuthRoutes` dispatch chain.
 *
 * If `lookup` is provided and the request body is missing required fields,
 * the missing values are resolved from the registry/vault (Option B). The
 * old "UI passes everything in the body" path keeps working unchanged.
 */
export async function handleOAuthInitiateRequest(
  deps: { pending: PendingAuthStore },
  req: IncomingMessage,
  res: ServerResponse,
  lookup?: OAuthInitiateLookupDeps
): Promise<boolean> {
  if (req.method?.toUpperCase() !== `POST`) return false
  const url = new URL(req.url ?? `/`, `http://localhost`)
  const match = matchOAuthInitiatePath(url.pathname)
  if (!match) return false

  const raw = await readJsonBody(req)
  let parsed: unknown
  if (raw.length === 0) {
    parsed = {}
  } else {
    try {
      parsed = JSON.parse(raw)
    } catch {
      res.writeHead(400, { 'content-type': `application/json; charset=utf-8` })
      res.end(JSON.stringify({ error: `invalid JSON body` }))
      return true
    }
  }
  if (typeof parsed !== `object` || parsed === null) {
    res.writeHead(400, { 'content-type': `application/json; charset=utf-8` })
    res.end(JSON.stringify({ error: `request body must be a JSON object` }))
    return true
  }

  const bodyParams = parsed as Partial<Omit<OAuthInitiateParams, `server`>>
  let params: OAuthInitiateParams = {
    server: match.server,
    authorizationUrl: bodyParams.authorizationUrl ?? ``,
    tokenUrl: bodyParams.tokenUrl ?? ``,
    clientId: bodyParams.clientId ?? ``,
    redirectUri: bodyParams.redirectUri ?? ``,
    scopes: bodyParams.scopes,
  }
  // Option B: when fields are missing and we have a registry/vault to
  // consult, resolve them from the live MCP config.
  const needsLookup =
    !params.authorizationUrl ||
    !params.tokenUrl ||
    !params.clientId ||
    !params.redirectUri
  if (needsLookup && lookup) {
    const resolved = await resolveOAuthInitiateParams(lookup, match.server)
    if (resolved) {
      params = {
        server: match.server,
        authorizationUrl: params.authorizationUrl || resolved.authorizationUrl,
        tokenUrl: params.tokenUrl || resolved.tokenUrl,
        clientId: params.clientId || resolved.clientId,
        redirectUri: params.redirectUri || resolved.redirectUri,
        scopes: params.scopes ?? resolved.scopes,
      }
    }
  }

  const result = await handleOAuthInitiate(deps, params)
  res.writeHead(result.status, {
    'content-type': `application/json; charset=utf-8`,
  })
  res.end(JSON.stringify(result.body))
  return true
}
