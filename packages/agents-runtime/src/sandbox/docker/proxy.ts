import { connect, type Socket } from 'node:net'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
  request as httpRequest,
} from 'node:http'
import type { NetworkPolicy } from '../types'

/**
 * Minimal HTTP/HTTPS forward proxy used by the docker sandbox adapter.
 * Listens on 127.0.0.1 (host loopback). Containers reach it via
 * `host.docker.internal:<port>` injected through `HTTP_PROXY` /
 * `HTTPS_PROXY` env vars. The allowlist is checked once per request /
 * CONNECT; updates take effect on the next request without a restart.
 *
 * Notes for reviewers:
 *  - This is *not* a defense against malicious code that bypasses the
 *    HTTP_PROXY env (e.g. raw TCP sockets to arbitrary addresses); for
 *    that you need a netns / iptables setup or rootless Podman + slirp4
 *    network filter. v1 ships the proxy as the egress policy enforcer for
 *    HTTP(S) traffic only and documents the gap.
 *  - Cleartext HTTP is intentionally supported because some package
 *    registries / dev fixtures still use it.
 */
export interface AllowlistProxy {
  readonly url: string
  updatePolicy(policy: NetworkPolicy): void
  close(): Promise<void>
}

export async function startAllowlistProxy(
  initialPolicy: NetworkPolicy
): Promise<AllowlistProxy> {
  let policy: NetworkPolicy = initialPolicy

  const isAllowed = (host: string): boolean => {
    switch (policy.mode) {
      case `allow-all`:
        return true
      case `deny-all`:
        return false
      case `allowlist`:
        return policy.allow.some((pattern) => matchesHost(host, pattern))
    }
  }

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      // Plain HTTP — req.url is the absolute URL because we're a proxy.
      try {
        if (!req.url) {
          res.writeHead(400)
          res.end(`bad request`)
          return
        }
        const target = new URL(req.url)
        if (!isAllowed(target.hostname)) {
          res.writeHead(403, { 'x-sandbox-denied': `policy` })
          res.end(
            `forbidden: host "${target.hostname}" is not in the sandbox allowlist`
          )
          return
        }
        const proxied = httpRequest(
          {
            host: target.hostname,
            port: target.port || 80,
            method: req.method,
            path: target.pathname + target.search,
            headers: req.headers,
          },
          (origRes) => {
            res.writeHead(origRes.statusCode ?? 502, origRes.headers)
            origRes.pipe(res)
          }
        )
        proxied.on(`error`, () => {
          if (!res.headersSent) {
            res.writeHead(502)
            res.end(`upstream error`)
          } else {
            res.end()
          }
        })
        req.pipe(proxied)
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500)
          res.end(`proxy error: ${(err as Error).message}`)
        } else {
          res.end()
        }
      }
    }
  )

  // CONNECT tunnel for HTTPS (and any port-explicit traffic).
  server.on(
    `connect`,
    (req: IncomingMessage, clientSocket: Socket, head: Buffer) => {
      const [host, portStr] = (req.url ?? ``).split(`:`)
      const port = Number(portStr) || 443
      if (!host) {
        clientSocket.end(`HTTP/1.1 400 Bad Request\r\n\r\n`)
        return
      }
      if (!isAllowed(host)) {
        clientSocket.end(
          `HTTP/1.1 403 Forbidden\r\nx-sandbox-denied: policy\r\n\r\n`
        )
        return
      }
      const upstream = connect(port, host, () => {
        clientSocket.write(`HTTP/1.1 200 Connection Established\r\n\r\n`)
        if (head.length > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      })
      upstream.on(`error`, () => {
        try {
          clientSocket.end(`HTTP/1.1 502 Bad Gateway\r\n\r\n`)
        } catch {
          /* socket already gone */
        }
      })
      clientSocket.on(`error`, () => {
        upstream.destroy()
      })
    }
  )

  await new Promise<void>((resolve, reject) => {
    server.once(`error`, reject)
    server.listen(0, `127.0.0.1`, () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === `string`) {
    server.close()
    throw new Error(`startAllowlistProxy: unexpected server address`)
  }
  const port = address.port

  return {
    url: `http://127.0.0.1:${port}`,
    updatePolicy(next) {
      policy = next
    },
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}

function matchesHost(host: string, pattern: string): boolean {
  if (pattern === host) return true
  if (pattern === `localhost` && (host === `127.0.0.1` || host === `::1`)) {
    return true
  }
  if (pattern.startsWith(`*.`)) {
    const suffix = pattern.slice(2)
    return host === suffix || host.endsWith(`.` + suffix)
  }
  return false
}
