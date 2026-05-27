import type { NetworkPolicy } from '../types'

/**
 * Host-side egress decision for the docker sandbox's `fetch()`. The docker
 * adapter has no in-container proxy: the request is issued directly from the
 * container, and the allowlist is enforced here, at the tool boundary on the
 * host, *before* the request is dispatched.
 *
 * This governs the `fetch` tool only — code run via `exec` has direct bridge
 * egress when the policy is not deny-all. deny-all is hard-enforced separately
 * by creating the container with `NetworkMode=none`.
 */
export function hostAllowedByPolicy(
  policy: NetworkPolicy,
  host: string
): boolean {
  switch (policy.mode) {
    case `allow-all`:
      return true
    case `deny-all`:
      return false
    case `allowlist`:
      return policy.allow.some((pattern) => matchesHost(host, pattern))
  }
}

/** Exact host, `localhost` loopback alias, or `*.suffix` wildcard. */
export function matchesHost(host: string, pattern: string): boolean {
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

const toQuad = (n: number): string =>
  [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(`.`)

/**
 * Parse the loose IPv4 forms libc's `inet_aton` (and therefore `getaddrinfo`
 * on Linux/macOS) accepts, returning the canonical dotted quad — or `null` if
 * `h` isn't a valid loose-IPv4 literal (a real hostname, >4 parts, an
 * out-of-range or malformed part). Accepts 1–4 dot-separated parts, each
 * decimal, octal (`0`-prefixed) or hex (`0x`-prefixed); a final part shorter
 * than the address absorbs the remaining low-order bytes, so `127.1`,
 * `127.0.1`, `0177.0.0.1` and `2130706433` all fold to `127.0.0.1`. These
 * forms resolve to private space via the OS resolver but slip past a
 * dotted-quad-only check, so they must be canonicalized before classification.
 */
function parseLooseIPv4(h: string): string | null {
  const parts = h.split(`.`)
  if (parts.length < 1 || parts.length > 4) return null
  const nums: Array<number> = []
  for (const part of parts) {
    let n: number
    if (/^0x[0-9a-f]+$/.test(part)) n = parseInt(part.slice(2), 16)
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8)
    else if (/^(?:0|[1-9]\d*)$/.test(part)) n = parseInt(part, 10)
    else return null // non-numeric label, or malformed (e.g. `08`, `0x`)
    if (!Number.isSafeInteger(n) || n < 0) return null
    nums.push(n)
  }
  // inet_aton packing: every part but the last is a single byte; the last
  // part fills all remaining low-order bytes (so its width grows as parts shrink).
  let addr = 0
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i]! > 255) return null
    addr += nums[i]! * 256 ** (3 - i)
  }
  const last = nums[nums.length - 1]!
  if (last >= 256 ** (4 - (nums.length - 1))) return null
  addr += last
  if (addr > 0xffffffff) return null
  return toQuad(addr >>> 0)
}

/**
 * Canonicalize a URL hostname for IP classification. Handles the encoded
 * literal forms an SSRF attempt reaches for: strips IPv6 brackets (Node's
 * `URL.hostname` keeps them, e.g. `[::1]`), unwraps `::ffff:`-mapped IPv4, and
 * folds every `inet_aton`-accepted IPv4 form (dotted-quad, shorthand,
 * whole-integer, octal, hex) to a dotted quad so none can slip past the
 * dotted-quad checks below.
 */
function canonicalizeHost(host: string): string {
  let h = host.trim().toLowerCase()
  if (h.startsWith(`[`) && h.endsWith(`]`)) h = h.slice(1, -1)
  // IPv4-mapped IPv6: ::ffff:a.b.c.d (or shorthand) or ::ffff:aabb:ccdd
  const mapped = /^::ffff:(.+)$/.exec(h)
  if (mapped) {
    const tail = mapped[1]!
    const quad = parseLooseIPv4(tail)
    if (quad) return quad
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
    if (hex)
      return toQuad(
        ((parseInt(hex[1]!, 16) << 16) | parseInt(hex[2]!, 16)) >>> 0
      )
  }
  // Any inet_aton-accepted IPv4 literal (dotted, shorthand, integer, octal, hex).
  const quad = parseLooseIPv4(h)
  if (quad) return quad
  return h
}

/**
 * Refuse literal private / link-local / loopback / cloud-metadata IPs
 * regardless of the allowlist — the most common LLM-attempted SSRF exfil
 * pattern. Encoded literal forms (integer/hex IPv4, `::ffff:`-mapped, bracketed
 * IPv6) are canonicalized first so they can't bypass the checks. DNS names that
 * *resolve* to private space, and redirects to a private host, are NOT caught
 * here (a known gap: closing it would require resolving on the host and pinning
 * the resolved IP per hop, which we don't do); this guard denies direct
 * literal-IP egress.
 */
export function isPrivateOrLinkLocal(rawHost: string): boolean {
  const host = canonicalizeHost(rawHost)
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
