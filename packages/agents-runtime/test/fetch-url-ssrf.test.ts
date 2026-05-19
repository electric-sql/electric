import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the mock is in place before fetch-url.ts imports it.
const dnsMock = vi.hoisted(() => ({
  lookup: vi.fn(),
}))
vi.mock(`node:dns/promises`, () => ({
  lookup: dnsMock.lookup,
}))

const { createFetchUrlTool } = await import(`../src/tools/fetch-url`)

describe(`fetch_url SSRF guard`, () => {
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
    dnsMock.lookup.mockReset()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it.each([
    [`http://169.254.169.254/latest/meta-data/`, `169.254.169.254`],
    [`http://127.0.0.1:8080/`, `127.0.0.1`],
    [`http://10.0.0.1/`, `10.0.0.1`],
    [`http://192.168.1.1/`, `192.168.1.1`],
    [`http://172.16.5.5/`, `172.16.5.5`],
    [`http://[::1]/`, `::1`],
  ])(`rejects literal private/loopback IP %s`, async (url, host) => {
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, { url, prompt: `extract` })
    expect((result.content[0] as { text: string }).text).toMatch(
      new RegExp(`${host.replace(/\./g, `\\.`)}`)
    )
    expect((result.content[0] as { text: string }).text).toMatch(
      /private\/loopback/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`rejects a public-looking hostname that resolves to a private address`, async () => {
    dnsMock.lookup.mockResolvedValue([{ address: `10.0.0.5`, family: 4 }])
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url: `http://attacker.example/`,
      prompt: `extract`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /resolves to private\/loopback address 10\.0\.0\.5/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`rejects when any of the resolved addresses is private (rebinding-style)`, async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: `93.184.216.34`, family: 4 },
      { address: `127.0.0.1`, family: 4 },
    ])
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url: `http://mixed.example/`,
      prompt: `extract`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /resolves to private\/loopback address 127\.0\.0\.1/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`localhost is blocked by default`, async () => {
    dnsMock.lookup.mockResolvedValue([{ address: `127.0.0.1`, family: 4 }])
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url: `http://localhost/`,
      prompt: `extract`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /Error fetching URL/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`allowedHosts: ['localhost'] bypasses the guard for that host`, async () => {
    const tool = createFetchUrlTool({
      extractWithLLM: async (t) => t,
      allowedHosts: [`localhost`],
    })
    const result = await tool.execute(`call`, {
      url: `http://localhost:9000/api`,
      prompt: `extract`,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://localhost:9000/api`)
    expect(dnsMock.lookup).not.toHaveBeenCalled()
    expect((result.content[0] as { text: string }).text).toBe(`ok`)
  })

  it(`allowedHosts only matches the named host; siblings stay blocked`, async () => {
    const tool = createFetchUrlTool({
      extractWithLLM: async (t) => t,
      allowedHosts: [`localhost`],
    })
    const result = await tool.execute(`call`, {
      url: `http://127.0.0.1/`,
      prompt: `extract`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /127\.0\.0\.1 is in a private\/loopback/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`a normal public hostname is allowed when DNS returns only public addresses`, async () => {
    dnsMock.lookup.mockResolvedValue([{ address: `93.184.216.34`, family: 4 }])
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url: `http://example.com/`,
      prompt: `extract`,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((result.content[0] as { text: string }).text).toBe(`ok`)
  })

  it(`rejects an unparseable URL before resolution`, async () => {
    const tool = createFetchUrlTool({ extractWithLLM: async (t) => t })
    const result = await tool.execute(`call`, {
      url: `not a url`,
      prompt: `extract`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /URL is not parseable/
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dnsMock.lookup).not.toHaveBeenCalled()
  })
})
