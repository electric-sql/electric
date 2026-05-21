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
        if (isPrivateOrLinkLocal(target.hostname)) {
          // Block RFC1918, link-local, and cloud-metadata addresses
          // independent of the allowlist. Allowing literal IPs would
          // sidestep DNS-based egress controls.
          res.writeHead(403, { 'x-sandbox-denied': `private-net` })
          res.end(
            `forbidden: literal private / link-local addresses are not routable through the sandbox proxy`
          )
          return
        }
        // Strip the caller-supplied Host header so the agent cannot use
        // an allowlisted absolute URL while routing the request to a
        // different vhost via the Host header. Reconstruct it from the
        // target authority.
        const headers: Record<string, string | string[] | undefined> = {
          ...req.headers,
          host: target.host,
        }
        delete headers[`proxy-authorization`]
        delete headers[`proxy-connection`]
        const proxied = httpRequest(
          {
            host: target.hostname,
            port: target.port || 80,
            method: req.method,
            path: target.pathname + target.search,
            headers,
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
      if (isPrivateOrLinkLocal(host)) {
        clientSocket.end(
          `HTTP/1.1 403 Forbidden\r\nx-sandbox-denied: private-net\r\n\r\n`
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

/**
 * Block requests to RFC1918 / link-local / loopback IP literals routed
 * through the proxy. DNS names that resolve to private space are NOT
 * blocked here — proper egress filtering would require resolving at the
 * proxy and rejecting based on result, which we accept as a known gap
 * (a "rebinding"-style attack via DNS could still hit internal hosts if
 * the allowlist is too permissive). This guard at least denies direct
 * literal-IP egress, which is the most common LLM-attempted exfil
 * pattern.
 */
function isPrivateOrLinkLocal(host: string): boolean {
  // IPv4
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (v4) {
    const [, a, b] = v4.map(Number) as unknown as [unknown, number, number]
    if (a === 10) return true
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 0) return true // unspecified
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  // IPv6 literal (very small allowlist of dangerous ranges)
  if (host === `::1` || host.toLowerCase().startsWith(`fe80:`)) return true
  if (
    host.toLowerCase().startsWith(`fc`) ||
    host.toLowerCase().startsWith(`fd`)
  )
    return true
  return false
}
