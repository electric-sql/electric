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

  it(`leaves configured headers to desktop injection inside Electron`, async () => {
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: {},
    }
    registerActiveServerHeaders({
      name: `Local`,
      url: `http://localhost:4437`,
      headers: { 'electric-principal': `system:dev-local` },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(
      `http://localhost:4437/_electric/entities/horton/a/send`,
      {
        method: `POST`,
        headers: { 'content-type': `text/plain` },
      }
    )

    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://localhost:4437/_electric/entities/horton/a/send`
    )
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`content-type`)).toBe(`text/plain`)
    expect(headers.has(`electric-principal`)).toBe(false)
  })

  it(`routes local mutating requests through the desktop server fetch transport`, async () => {
    const desktopFetch = vi.fn().mockResolvedValue({
      url: `http://127.0.0.1:4437/_electric/entities/horton/a`,
      status: 204,
      statusText: `No Content`,
      headers: {},
      body: ``,
    })
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { serverFetch: desktopFetch },
    }
    registerActiveServerHeaders({
      name: `Local`,
      url: `http://127.0.0.1:4437`,
      headers: { 'electric-principal': `system:dev-local` },
    })

    const fetchMock = vi.spyOn(globalThis, `fetch`)

    const response = await serverFetch(
      `http://127.0.0.1:4437/_electric/entities/horton/a`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({}),
      }
    )

    expect(response.status).toBe(204)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(desktopFetch).toHaveBeenCalledWith({
      url: `http://127.0.0.1:4437/_electric/entities/horton/a`,
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: `{}`,
    })
  })

  it(`keeps local GET requests in the browser in Electron`, async () => {
    const desktopFetch = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { serverFetch: desktopFetch },
    }
    registerActiveServerHeaders({
      name: `Local`,
      url: `http://127.0.0.1:4437`,
      headers: { 'electric-principal': `system:dev-local` },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(`http://127.0.0.1:4437/_electric/shape`)

    expect(desktopFetch).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it(`keeps non-local mutating requests in the browser in Electron`, async () => {
    const desktopFetch = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { serverFetch: desktopFetch },
    }
    registerActiveServerHeaders({
      name: `Cloud`,
      url: `https://agents.example.test`,
      headers: { Authorization: `Bearer tenant-token` },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    await serverFetch(
      `https://agents.example.test/_electric/entities/horton/a`,
      {
        method: `PUT`,
        body: JSON.stringify({}),
      }
    )

    expect(desktopFetch).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it(`injects configured headers when a local Electron request falls back from desktop transport`, async () => {
    const desktopFetch = vi.fn()
    ;(globalThis as { window?: unknown }).window = {
      electronAPI: { serverFetch: desktopFetch },
    }
    registerActiveServerHeaders({
      name: `Local`,
      url: `http://127.0.0.1:4437`,
      headers: {
        'electric-principal': `system:dev-local`,
        Authorization: `Bearer local-token`,
      },
    })

    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`ok`))

    const form = new FormData()
    form.set(`file`, new Blob([`hi`], { type: `text/plain` }), `hi.txt`)

    await serverFetch(
      `http://127.0.0.1:4437/_electric/entities/horton/a/attachments`,
      {
        method: `POST`,
        body: form,
      }
    )

    expect(desktopFetch).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers)
    expect(headers.get(`electric-principal`)).toBe(`system:dev-local`)
    expect(headers.get(`authorization`)).toBe(`Bearer local-token`)
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
