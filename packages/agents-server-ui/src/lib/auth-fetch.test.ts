import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDesktopAssertedAuthHeaders, serverFetch } from './auth-fetch'

function installWindow(electronAPI?: Window[`electronAPI`]): void {
  Object.defineProperty(globalThis, `window`, {
    value: { electronAPI },
    configurable: true,
  })
}

describe(`desktop asserted auth fetch helpers`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as { window?: unknown }).window
  })

  it(`returns no asserted auth headers outside desktop`, async () => {
    delete (globalThis as { window?: unknown }).window
    await expect(getDesktopAssertedAuthHeaders()).resolves.toEqual({})
  })

  it(`adds desktop asserted auth headers to server requests`, async () => {
    installWindow({
      getAssertedAuthHeaders: async () => ({
        'X-Electric-Asserted-Email': `alice@example.com`,
        'X-Electric-Asserted-Name': `Alice`,
      }),
    } as unknown as Window[`electronAPI`])

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`http://127.0.0.1:4447/horton/session-1`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: `{}`,
    })

    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.get(`content-type`)).toBe(`application/json`)
    expect(headers.get(`x-electric-asserted-email`)).toBe(`alice@example.com`)
    expect(headers.get(`x-electric-asserted-name`)).toBe(`Alice`)
  })

  it(`does not override explicit request auth headers`, async () => {
    installWindow({
      getAssertedAuthHeaders: async () => ({
        'X-Electric-Asserted-Email': `desktop@example.com`,
      }),
    } as unknown as Window[`electronAPI`])

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`http://example.test`, {
      headers: { 'X-Electric-Asserted-Email': `request@example.com` },
    })

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`x-electric-asserted-email`)).toBe(`request@example.com`)
  })
})
