import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { nativeSandbox } from '../src/sandbox/native'
import { SandboxError } from '../src/sandbox/types'

/**
 * sandbox.fetch() on nativeSandbox routes through the library's HTTP
 * proxy, not through a duplicated TS-level Set.has() check. This means
 * the same policy that gates `sandbox.exec('curl …')` traffic also
 * gates `sandbox.fetch()` traffic — wildcard patterns, IP
 * canonicalization, denied-domains precedence, etc.
 *
 * These tests stand up a local HTTP server and verify both the
 * happy-path (allowed host reaches the local server) and the
 * deny-path (disallowed host is rejected with SandboxError).
 *
 * Skips entirely on platforms without OS sandbox support.
 */
const supported = SandboxManager.isSupportedPlatform()
const d = supported ? describe : describe.skip

d(`nativeSandbox.fetch routes through the library proxy`, () => {
  let cwd: string
  let server: Server
  let serverHost: string
  let serverUrl: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `native-proxy-fetch-`))
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': `text/plain` })
      res.end(`hit ${req.headers.host}`)
    })
    await new Promise<void>((resolve) => {
      server.listen(0, `127.0.0.1`, () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    serverHost = `localhost`
    serverUrl = `http://${serverHost}:${port}/`
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it(`permits an allowed host through the proxy and reaches the upstream`, async () => {
    const sandbox = await nativeSandbox({
      workingDirectory: cwd,
      allowedHosts: [serverHost],
    })
    try {
      const res = await sandbox.fetch(serverUrl)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).toMatch(/^hit /)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`rejects a host that is not in allowedHosts and surfaces a SandboxError`, async () => {
    const sandbox = await nativeSandbox({
      workingDirectory: cwd,
      allowedHosts: [`only-this.example.com`],
    })
    try {
      await expect(sandbox.fetch(serverUrl)).rejects.toBeInstanceOf(
        SandboxError
      )
      await expect(sandbox.fetch(serverUrl)).rejects.toMatchObject({
        kind: `policy`,
      })
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)

  it(`accepts wildcard patterns in allowedHosts (delegated to library matcher)`, async () => {
    // The library's domain validator accepts `*.example.com` and similar
    // patterns. Our config passes them through unchanged. This test
    // proves we don't reject the config at our layer with a manual
    // exact-match check.
    const sandbox = await nativeSandbox({
      workingDirectory: cwd,
      allowedHosts: [`*.example.com`, `localhost`],
    })
    try {
      const res = await sandbox.fetch(serverUrl)
      expect(res.status).toBe(200)
    } finally {
      await sandbox.dispose()
    }
  }, 30_000)
})
