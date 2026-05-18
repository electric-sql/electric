import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getActivePrincipal,
  getConfiguredActivePrincipal,
  registerActiveServerHeaders,
  serverFetch,
} from './auth-fetch'

describe(`server fetch helpers`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    registerActiveServerHeaders(null)
    delete (globalThis as { window?: unknown }).window
  })

  it(`preserves explicit request headers`, async () => {
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`http://example.test`, {
      headers: { Authorization: `Bearer request-token` },
    })

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer request-token`)
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

  it(`does not override explicit headers with configured server headers`, async () => {
    registerActiveServerHeaders({
      name: `Tenant`,
      url: `https://agents.example.test`,
      headers: {
        Authorization: `Bearer tenant-token`,
      },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`https://agents.example.test/_electric/runners`, {
      headers: { Authorization: `Bearer request-token` },
    })

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`authorization`)).toBe(`Bearer request-token`)
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

  it(`returns the active principal as a canonical principal URL`, () => {
    registerActiveServerHeaders({
      name: `Tenant`,
      url: `https://agents.example.test`,
      headers: { 'electric-principal': `system:dev-local` },
    })

    expect(getActivePrincipal()).toBe(`/principal/system%3Adev-local`)
    expect(getConfiguredActivePrincipal()).toBe(`/principal/system%3Adev-local`)
  })

  it(`uses the local dev principal when no active principal is configured`, () => {
    registerActiveServerHeaders({
      name: `Local`,
      url: `http://127.0.0.1:4437`,
    })

    expect(getConfiguredActivePrincipal()).toBe(null)
    expect(getActivePrincipal()).toBe(`/principal/system%3Adev-local`)
  })
})
