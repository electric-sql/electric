import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFetchUrlTool } from '../src/tools/fetch-url'

// Characterization: createFetchUrlTool today has no host policy — no
// allowlist, no private-IP denylist, no cloud-metadata IP filter. The tests
// below capture that surface so a follow-up SSRF-hardening PR has an explicit
// regression target.
describe(`fetch_url — current SSRF surface`, () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response(`ok`, {
          status: 200,
          headers: { 'content-type': `text/plain` },
        })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it.each([
    `http://169.254.169.254/latest/meta-data/`, // AWS / GCP metadata IP
    `http://127.0.0.1:8080/`, // loopback
    `http://10.0.0.1/`, // RFC1918
    `http://192.168.1.1/`, // RFC1918
  ])(`fetches %s without rejecting it`, async (url) => {
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url,
      prompt: `extract content`,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(url)
    // The tool returns the extracted content, not an SSRF guard error.
    expect((result.content[0] as { text: string }).text).toBe(`ok`)
  })

  it(`follows redirects (redirect: 'follow') — DNS-rebinding / redirect-to-private not blocked`, async () => {
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    await tool.execute(`call`, {
      url: `http://example.com/`,
      prompt: `extract`,
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.redirect).toBe(`follow`)
  })
})
