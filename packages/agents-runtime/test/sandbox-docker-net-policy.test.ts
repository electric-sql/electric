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
})
