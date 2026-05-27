import { describe, expect, it } from 'vitest'
import {
  hostAllowedByPolicy,
  isPrivateOrLinkLocal,
  matchesHost,
} from '../src/sandbox/docker/net-policy'

// Host-side egress enforcement for the docker sandbox's fetch(). Pure logic,
// no container — this is where the allowlist + SSRF guard live now that the
// in-container proxy is gone.

describe(`hostAllowedByPolicy`, () => {
  it(`allow-all permits any host`, () => {
    expect(hostAllowedByPolicy({ mode: `allow-all` }, `example.com`)).toBe(true)
  })

  it(`deny-all permits nothing`, () => {
    expect(hostAllowedByPolicy({ mode: `deny-all` }, `example.com`)).toBe(false)
  })

  it(`allowlist permits only listed hosts (incl. wildcard)`, () => {
    const policy = {
      mode: `allowlist`,
      allow: [`example.com`, `*.test.dev`],
    } as const
    expect(hostAllowedByPolicy(policy, `example.com`)).toBe(true)
    expect(hostAllowedByPolicy(policy, `api.test.dev`)).toBe(true)
    expect(hostAllowedByPolicy(policy, `test.dev`)).toBe(true)
    expect(hostAllowedByPolicy(policy, `evil.com`)).toBe(false)
    expect(hostAllowedByPolicy(policy, `notexample.com`)).toBe(false)
  })
})

describe(`matchesHost`, () => {
  it(`matches exact, localhost loopback, and *.suffix`, () => {
    expect(matchesHost(`example.com`, `example.com`)).toBe(true)
    expect(matchesHost(`127.0.0.1`, `localhost`)).toBe(true)
    expect(matchesHost(`::1`, `localhost`)).toBe(true)
    expect(matchesHost(`a.b.example.com`, `*.example.com`)).toBe(true)
    expect(matchesHost(`example.com`, `*.example.com`)).toBe(true)
    expect(matchesHost(`evil.com`, `*.example.com`)).toBe(false)
  })
})

describe(`isPrivateOrLinkLocal (SSRF guard)`, () => {
  it.each([
    `169.254.169.254`, // AWS/GCP metadata + link-local
    `127.0.0.1`, // loopback
    `10.0.0.1`, // RFC1918
    `172.16.5.4`, // RFC1918
    `192.168.1.1`, // RFC1918
    `100.64.0.1`, // CGNAT
    `0.0.0.0`, // unspecified
    `::1`, // IPv6 loopback
    `fe80::1`, // IPv6 link-local
    `fd00::1`, // IPv6 ULA
  ])(`flags %s as private/link-local`, (host) => {
    expect(isPrivateOrLinkLocal(host)).toBe(true)
  })

  it.each([`93.184.216.34`, `example.com`, `8.8.8.8`, `172.32.0.1`])(
    `treats %s as public`,
    (host) => {
      expect(isPrivateOrLinkLocal(host)).toBe(false)
    }
  )

  it.each([
    `2130706433`, // 127.0.0.1 as a decimal integer
    `0x7f000001`, // 127.0.0.1 in hex
    `[::1]`, // bracketed IPv6 loopback (URL.hostname keeps the brackets)
    `[fe80::1]`, // bracketed IPv6 link-local
    `::ffff:169.254.169.254`, // IPv4-mapped IPv6 metadata IP
    `[::ffff:a9fe:a9fe]`, // IPv4-mapped IPv6 metadata IP, hex + brackets
    `2852039166`, // 169.254.169.254 as a decimal integer
  ])(`flags encoded literal %s as private/link-local`, (host) => {
    expect(isPrivateOrLinkLocal(host)).toBe(true)
  })

  // inet_aton shorthand: libc's resolver (used by getaddrinfo on Linux/macOS)
  // accepts 1–4 dot-separated parts, each decimal/octal/hex, packing the final
  // part into the low-order bytes. A dotted-quad-only guard misses these, yet
  // they resolve to private space via the OS resolver — so they're a real SSRF
  // bypass for fetch_url under the default (allow-all) docker profile.
  it.each([
    `127.1`, // 2-part: 127.0.0.1
    `127.0.1`, // 3-part: 127.0.0.1
    `0177.0.0.1`, // octal first octet: 127.0.0.1
    `0x7f.0.0.1`, // hex first octet: 127.0.0.1
    `0x7f.1`, // hex + 2-part: 127.0.0.1
    `017700000001`, // octal whole-integer: 127.0.0.1
    `0xa9fea9fe`, // 169.254.169.254 in hex (metadata)
    `169.254.43518`, // 3-part metadata: 169.254.169.254
    `10.1`, // 2-part RFC1918: 10.0.0.1
    `0xa.0.0.1`, // hex first octet RFC1918: 10.0.0.1
  ])(`flags inet_aton shorthand %s as private/link-local`, (host) => {
    expect(isPrivateOrLinkLocal(host)).toBe(true)
  })

  // The loose parser must not over-claim: numeric-looking public addresses and
  // anything that isn't a valid IPv4 literal (real hostnames, >4 parts,
  // out-of-range octets) stay public so legitimate fetches aren't blocked.
  it.each([
    `8.8`, // 2-part: 8.0.0.8 (public)
    `93.184.216.34`, // dotted-quad public
    `172.32.0.1`, // just outside RFC1918
    `1.2.3.4.5`, // 5 parts — not an IPv4 literal, treat as hostname
    `08.0.0.1`, // invalid octal (8 not an octal digit) — not an IP
    `0x7g.0.0.1`, // invalid hex — not an IP
  ])(`treats %s as public`, (host) => {
    expect(isPrivateOrLinkLocal(host)).toBe(false)
  })
})
