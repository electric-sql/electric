import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getDesktopAssertedAuthHeaders,
  registerActiveServerHeaders,
  serverFetch,
} from './auth-fetch'

function installWindow(electronAPI?: Window[`electronAPI`]): void {
  Object.defineProperty(globalThis, `window`, {
    value: { electronAPI },
    configurable: true,
  })
}

describe(`desktop asserted auth fetch helpers`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    registerActiveServerHeaders(null)
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

  it(`adds configured active server headers to matching requests`, async () => {
    registerActiveServerHeaders({
      name: `Tenant`,
      url: `https://agents.example.test/workspace?secret=abc`,
      headers: {
        Authorization: `Bearer tenant-token`,
        'X-Tenant': `tenant-1`,
      },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(
      `https://agents.example.test/workspace/_electric/entities/horton/a`
    )

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer tenant-token`)
    expect(headers.get(`x-tenant`)).toBe(`tenant-1`)
  })

  it(`prefers configured server user headers over desktop asserted defaults`, async () => {
    installWindow({
      getAssertedAuthHeaders: async () => ({
        'X-Electric-Asserted-Email': `desktop@example.com`,
        'X-Electric-Asserted-Name': `Desktop User`,
      }),
    } as unknown as Window[`electronAPI`])
    registerActiveServerHeaders({
      name: `Tenant`,
      url: `https://agents.example.test`,
      headers: {
        'X-Electric-Asserted-Email': `tenant-user@example.com`,
      },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`https://agents.example.test/_electric/runners`)

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`x-electric-asserted-email`)).toBe(
      `tenant-user@example.com`
    )
    expect(headers.get(`x-electric-asserted-name`)).toBe(`Desktop User`)
  })

  it(`does not send configured active server headers to other origins`, async () => {
    registerActiveServerHeaders({
      name: `Tenant`,
      url: `https://agents.example.test`,
      headers: { Authorization: `Bearer tenant-token` },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`https://other.example.test/_electric/health`)

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.has(`authorization`)).toBe(false)
  })
})
