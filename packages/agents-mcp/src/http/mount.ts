import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Registry } from '../registry'
import type { CredentialStore } from '../credentials/types'
import { applyCors } from './cors'
import { handleOAuthCallback } from './oauth-callback'

export interface MountMcpHttpOpts {
  /** Plain Node http.Server. Caller is responsible for `listen`. */
  server: Server
  registry: Registry
  /** Used in Phase 3 for OAuth. */
  credentials?: CredentialStore
  /** Publicly-reachable URL of the runtime (used for OAuth redirect URIs in Phase 3). */
  publicUrl: string
  corsOrigin?: string[] | `*`
  /** Reserved for production: bearer-token check. Default: allow all. */
  requireAuth?: (req: IncomingMessage) => boolean
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on(`data`, (c) => chunks.push(c as Buffer))
    req.on(`end`, () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString(`utf8`))
            : {}
        )
      } catch (err) {
        reject(err)
      }
    })
    req.on(`error`, reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader(`Content-Type`, `application/json`)
  res.end(JSON.stringify(body))
}

export function mountMcpHttp(opts: MountMcpHttpOpts): void {
  const cors = { origins: opts.corsOrigin ?? `*` }
  const auth = opts.requireAuth ?? (() => true)

  opts.server.on(`request`, async (req, res) => {
    if (applyCors(req, res, cors)) return
    if (!req.url) return
    if (!req.url.startsWith(`/api/mcp/`) && !req.url.startsWith(`/oauth/`))
      return
    if (!auth(req)) {
      send(res, 401, { error: `unauthorized` })
      return
    }

    try {
      const u = new URL(req.url, `http://x`)

      const cb = u.pathname.match(/^\/oauth\/callback\/([^/]+)$/)
      if (cb && req.method === `GET`) {
        const serverName = decodeURIComponent(cb[1]!)
        await handleOAuthCallback(req, res, opts.registry, serverName)
        return
      }

      if (req.method === `GET` && u.pathname === `/api/mcp/servers`) {
        send(res, 200, { servers: opts.registry.list() })
        return
      }

      if (req.method === `POST` && u.pathname === `/api/mcp/servers`) {
        const body = (await readJson(req)) as Parameters<
          Registry[`addServer`]
        >[0]
        const result = await opts.registry.addServer(body)
        send(res, 200, result)
        return
      }

      const match = u.pathname.match(
        /^\/api\/mcp\/servers\/([^/]+)(?:\/(authorize|disable|enable|reconnect))?$/
      )
      if (match) {
        const name = decodeURIComponent(match[1]!)
        const action = match[2]
        if (req.method === `DELETE`) {
          await opts.registry.removeServer(name)
          send(res, 200, { ok: true })
          return
        }
        if (req.method === `POST` && action === `reconnect`) {
          const entry = opts.registry.get(name)
          if (!entry) {
            send(res, 404, { error: `unknown server` })
            return
          }
          const result = await opts.registry.addServer(entry.config)
          send(res, 200, result)
          return
        }
        // disable/enable/authorize wired in later phases
        send(res, 501, { error: `action ${action} not yet implemented` })
        return
      }

      send(res, 404, { error: `not found` })
    } catch (err) {
      send(res, 500, { error: (err as Error).message })
    }
  })
}
