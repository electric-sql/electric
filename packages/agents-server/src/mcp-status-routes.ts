import type { IncomingMessage, ServerResponse } from 'node:http'
import type { KeyVault, Registry } from '@electric-ax/agents-mcp'

/**
 * Dependencies for the MCP status + management API.
 *
 * The registry exposes the live set of MCP servers (status, last error,
 * tools), and the vault holds the secrets the registry consults when
 * resolving auth headers. Both are owned by the agents-server bootstrap;
 * this module only consumes the interfaces.
 */
export interface StatusRouteDeps {
  registry: Registry
  vault: KeyVault
}

/**
 * Public shape returned by the list/get endpoints.
 *
 * Designed to be UI-friendly: the Connected Services page (Task 26) reads
 * this directly and renders a row per server. We deliberately avoid
 * leaking secrets (e.g. the resolved auth header value); only the
 * `authMode` enum and `valueRef`-style identifiers are exposed via the
 * config in other endpoints.
 */
export interface ServerSummary {
  name: string
  transport: string
  authMode: string | null
  /**
   * Sub-mode for `authorizationCode` servers. Indicates whether the
   * authorize action should pop a browser tab (`browser`) or kick off the
   * device-code flow (`device`). `null` for non-OAuth servers and for
   * OAuth servers where the flow isn't an authorization-code variant.
   */
  oauthFlow: `browser` | `device` | null
  status: string
  lastError?: string
  toolCount: number
}

function summarize(e: ReturnType<Registry[`list`]>[number]): ServerSummary {
  let oauthFlow: `browser` | `device` | null = null
  if (
    e.config.transport === `http` &&
    e.config.auth.mode === `authorizationCode`
  ) {
    oauthFlow = e.config.auth.flow
  }
  return {
    name: e.name,
    transport: e.config.transport,
    authMode: e.config.transport === `http` ? e.config.auth.mode : null,
    oauthFlow,
    status: e.status,
    lastError: e.lastError,
    toolCount: e.tools?.length ?? 0,
  }
}

/**
 * Pure handler: list every registered MCP server as a {@link ServerSummary}.
 *
 * Returns an empty array when no servers are registered (rather than
 * throwing) so the UI can render a "no services configured" empty-state
 * without special-casing.
 */
export function listServers(deps: StatusRouteDeps): ServerSummary[] {
  return deps.registry.list().map(summarize)
}

/**
 * Pure handler: fetch one server by name. Returns `null` when unknown so
 * the route layer can translate that into a 404.
 */
export function getServer(
  deps: StatusRouteDeps,
  name: string
): ServerSummary | null {
  const e = deps.registry.get(name)
  if (!e) return null
  return summarize(e)
}

/**
 * Pure handler: flip a server to `disabled`. Returns `{ ok: false }` when
 * the server isn't registered (the route layer maps that to 404).
 */
export function disableServer(
  deps: StatusRouteDeps,
  name: string
): { ok: boolean } {
  if (!deps.registry.get(name)) return { ok: false }
  deps.registry.disable(name)
  return { ok: true }
}

/**
 * Pure handler: clear the `disabled` flag. The registry's `enable()` is a
 * no-op when the server isn't currently disabled, so this is safe to call
 * unconditionally as long as the server exists.
 */
export function enableServer(
  deps: StatusRouteDeps,
  name: string
): { ok: boolean } {
  if (!deps.registry.get(name)) return { ok: false }
  deps.registry.enable(name)
  return { ok: true }
}

/**
 * Pure handler: clear vault credentials for a server.
 *
 * For `apiKey` servers we delete the single `valueRef` entry. For
 * `clientCredentials` we delete both client id/secret refs. For
 * `authorizationCode` the OAuth coordinator's token cache is in-memory,
 * so we instead disable the server: re-enabling and re-using forces a
 * fresh authorization round-trip.
 *
 * In every case we also flip the server to `disabled` so the next
 * `enable` is an explicit user action — preventing silent reuse of a
 * stale credential after a "forget me" click.
 */
export async function deleteCredentials(
  deps: StatusRouteDeps,
  name: string
): Promise<{ ok: boolean }> {
  const entry = deps.registry.get(name)
  if (!entry) return { ok: false }
  if (entry.config.transport === `http`) {
    const auth = entry.config.auth
    if (auth.mode === `apiKey`) {
      await deps.vault.delete(auth.valueRef)
    } else if (auth.mode === `clientCredentials`) {
      await deps.vault.delete(auth.clientIdRef)
      await deps.vault.delete(auth.clientSecretRef)
    }
    // authorizationCode: in-memory token cache; disable below forces
    // a fresh auth flow on re-enable.
  }
  deps.registry.disable(name)
  return { ok: true }
}

/**
 * Match `GET /api/mcp/servers` (with or without trailing slash).
 *
 * Kept separate from {@link matchServerActionPath} because it has no
 * path parameters — distinguishing them in the dispatcher is cleaner
 * than threading an "is collection" flag.
 */
export function matchListServersPath(path: string): boolean {
  return path === `/api/mcp/servers` || path === `/api/mcp/servers/`
}

/**
 * Match `/api/mcp/servers/:server` and `/api/mcp/servers/:server/:action`.
 *
 * Returns `{ server, action }` where `action` is the empty string for the
 * single-server endpoint. The route layer then dispatches on
 * `(method, action)`.
 */
export function matchServerActionPath(
  path: string
): { server: string; action: string } | null {
  const m = path.match(/^\/api\/mcp\/servers\/([^/]+)(?:\/([^/]+))?$/)
  if (!m) return null
  return { server: decodeURIComponent(m[1]!), action: m[2] ?? `` }
}

/**
 * Pure dispatcher used by both the native-node mount and tests.
 *
 * Returns `null` when the request isn't ours so callers can chain into
 * other routes; returns `{ status, body }` when handled. Bodies are
 * always JSON-serialisable values (arrays, plain objects).
 */
export async function handleStatusRequest(
  deps: StatusRouteDeps,
  req: { method?: string; url?: string }
): Promise<{ status: number; body: unknown } | null> {
  const path = (req.url ?? ``).split(`?`)[0]!
  const method = req.method?.toUpperCase()

  if (method === `GET` && matchListServersPath(path)) {
    return { status: 200, body: listServers(deps) }
  }

  const m = matchServerActionPath(path)
  if (!m) return null

  if (method === `GET` && m.action === ``) {
    const r = getServer(deps, m.server)
    return r
      ? { status: 200, body: r }
      : { status: 404, body: { error: `not found` } }
  }

  if (method === `POST` && m.action === `disable`) {
    const r = disableServer(deps, m.server)
    return r.ok
      ? { status: 200, body: r }
      : { status: 404, body: { error: `not found` } }
  }

  if (method === `POST` && m.action === `enable`) {
    const r = enableServer(deps, m.server)
    return r.ok
      ? { status: 200, body: r }
      : { status: 404, body: { error: `not found` } }
  }

  if (method === `DELETE` && m.action === `credentials`) {
    const r = await deleteCredentials(deps, m.server)
    return r.ok
      ? { status: 200, body: r }
      : { status: 404, body: { error: `not found` } }
  }

  return null
}

export interface StatusRouteMount {
  /**
   * Try to handle an incoming request as an MCP status/management call.
   * Returns `true` when the request was handled (and a response written),
   * `false` otherwise — letting the caller chain to subsequent routes.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
}

/**
 * Native-node HTTP binding. Mirrors `mountOAuthRoutes` from
 * `oauth-routes.ts`: a thin shim over the pure dispatcher that translates
 * a `{ status, body }` triple into a JSON response.
 *
 * None of the status endpoints currently consume request bodies; if a
 * future endpoint needs one, copy the `readJsonBody` pattern from
 * `oauth-routes.ts`.
 */
export function mountStatusRoutes(deps: StatusRouteDeps): StatusRouteMount {
  return {
    async handle(req, res) {
      const out = await handleStatusRequest(deps, req)
      if (!out) return false
      res.writeHead(out.status, {
        'content-type': `application/json; charset=utf-8`,
      })
      res.end(JSON.stringify(out.body))
      return true
    },
  }
}
