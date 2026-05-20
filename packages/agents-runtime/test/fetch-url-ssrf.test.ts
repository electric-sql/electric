import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFetchUrlTool } from '../src/tools/fetch-url'
import { unrestrictedSandbox } from '../src/sandbox/unrestricted'

// Characterization: createFetchUrlTool routed through unrestrictedSandbox
// has no host policy — no allowlist, no private-IP denylist, no
// cloud-metadata IP filter. The tests below capture that surface so a
// follow-up SSRF-hardening PR (NetPolicy on sandbox.fetch) has an explicit
// regression target.
//
// Under remoteSandbox or dockerSandbox the hostname allowlist already
// rejects these — see sandbox-remote.test.ts and sandbox-docker.test.ts.
describe(`fetch_url — current SSRF surface (unrestricted sandbox)`, () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), `fetch-ssrf-`))
    fetchMock = vi.fn(
      async () =>
        new Response(`ok`, {
          status: 200,
          headers: { 'content-type': `text/plain` },
        })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await rm(cwd, { recursive: true, force: true })
  })

  it.each([
    `http://169.254.169.254/latest/meta-data/`, // AWS / GCP metadata IP
    `http://127.0.0.1:8080/`, // loopback
    `http://10.0.0.1/`, // RFC1918
    `http://192.168.1.1/`, // RFC1918
  ])(`fetches %s without rejecting it`, async (url) => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      const tool = createFetchUrlTool(sandbox, {
        extractWithLLM: async (t: string) => t,
      })
      const result = await tool.execute(`call`, {
        url,
        prompt: `extract content`,
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
      // The tool returns the extracted content, not an SSRF guard error.
      expect((result.content[0] as { text: string }).text).toBe(`ok`)
    } finally {
      await sandbox.dispose()
    }
  })

  it(`follows redirects (redirect: 'follow') — DNS-rebinding / redirect-to-private not blocked`, async () => {
    const sandbox = await unrestrictedSandbox({ workingDirectory: cwd })
    try {
      const tool = createFetchUrlTool(sandbox, {
        extractWithLLM: async (t: string) => t,
      })
      await tool.execute(`call`, {
        url: `http://example.com/`,
        prompt: `extract`,
      })
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
      expect(init?.redirect).toBe(`follow`)
    } finally {
      await sandbox.dispose()
    }
  })
})
