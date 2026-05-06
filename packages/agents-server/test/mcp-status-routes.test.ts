import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createFileVault,
  createRegistry,
  type KeyVault,
  type Registry,
} from '@electric-ax/agents-mcp'
import {
  deleteCredentials,
  disableServer,
  enableServer,
  getServer,
  handleStatusRequest,
  listServers,
  matchListServersPath,
  matchServerActionPath,
  mountStatusRoutes,
} from '../src/mcp-status-routes'

/**
 * Build a fake transport handle for tests. Behaves like an in-memory MCP
 * server: connecting flips a flag, the client exposes a single `echo`
 * tool. This mirrors the fake used in `agents-mcp/test/registry.test.ts`
 * so registry behaviour stays consistent across tests.
 */
function fakeTransportFactory() {
  return () => {
    let connected = false
    return {
      async connect() {
        connected = true
      },
      async close() {
        connected = false
      },
      get client() {
        if (!connected) return null
        return {
          listTools: async () => ({
            tools: [{ name: `echo`, description: `echo` }],
          }),
        } as any
      },
    }
  }
}

function makeDeps(): { registry: Registry; vault: KeyVault } {
  const dir = mkdtempSync(join(tmpdir(), `mcp-status-`))
  const vault = createFileVault(join(dir, `vault.json`))
  const registry = createRegistry({
    vault,
    transportFactory: fakeTransportFactory(),
  })
  return { vault, registry }
}

describe(`matchListServersPath`, () => {
  it(`matches with and without trailing slash`, () => {
    expect(matchListServersPath(`/api/mcp/servers`)).toBe(true)
    expect(matchListServersPath(`/api/mcp/servers/`)).toBe(true)
  })

  it(`rejects unrelated paths`, () => {
    expect(matchListServersPath(`/api/mcp/servers/gh`)).toBe(false)
    expect(matchListServersPath(`/api/mcp`)).toBe(false)
    expect(matchListServersPath(`/something/else`)).toBe(false)
  })
})

describe(`matchServerActionPath`, () => {
  it(`matches single-server detail`, () => {
    expect(matchServerActionPath(`/api/mcp/servers/gh`)).toEqual({
      server: `gh`,
      action: ``,
    })
  })

  it(`matches an action segment`, () => {
    expect(matchServerActionPath(`/api/mcp/servers/gh/disable`)).toEqual({
      server: `gh`,
      action: `disable`,
    })
    expect(matchServerActionPath(`/api/mcp/servers/gh/enable`)).toEqual({
      server: `gh`,
      action: `enable`,
    })
    expect(matchServerActionPath(`/api/mcp/servers/gh/credentials`)).toEqual({
      server: `gh`,
      action: `credentials`,
    })
  })

  it(`decodes the server segment`, () => {
    expect(
      matchServerActionPath(`/api/mcp/servers/my%20server/enable`)
    ).toEqual({ server: `my server`, action: `enable` })
  })

  it(`rejects unrelated paths`, () => {
    expect(matchServerActionPath(`/api/mcp/servers`)).toBeNull()
    expect(matchServerActionPath(`/api/mcp/servers/`)).toBeNull()
    expect(matchServerActionPath(`/api/mcp/servers/gh/a/b`)).toBeNull()
    expect(matchServerActionPath(`/oauth/callback/gh`)).toBeNull()
  })
})

describe(`listServers`, () => {
  it(`returns empty when no servers registered`, () => {
    const deps = makeDeps()
    expect(listServers(deps)).toEqual([])
  })

  it(`returns one entry per registered server`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    const list = listServers(deps)
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe(`a`)
    expect(list[0]!.transport).toBe(`stdio`)
    expect(list[0]!.authMode).toBeNull()
    expect(list[0]!.status).toBe(`healthy`)
    expect(list[0]!.toolCount).toBe(1)
  })

  it(`reports authMode for http servers`, async () => {
    const deps = makeDeps()
    await deps.vault.set(`vault://gh/token`, `secret`)
    await deps.registry.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `apiKey`,
            headerName: `X-Token`,
            valueRef: `vault://gh/token`,
          },
        },
      },
    })
    const list = listServers(deps)
    expect(list[0]!.authMode).toBe(`apiKey`)
  })
})

describe(`getServer`, () => {
  it(`returns single server detail`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    expect(getServer(deps, `a`)?.name).toBe(`a`)
  })

  it(`returns null for unknown server`, () => {
    const deps = makeDeps()
    expect(getServer(deps, `missing`)).toBeNull()
  })
})

describe(`disableServer / enableServer`, () => {
  it(`flips status between disabled and back`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    expect(disableServer(deps, `a`).ok).toBe(true)
    expect(getServer(deps, `a`)?.status).toBe(`disabled`)
    expect(enableServer(deps, `a`).ok).toBe(true)
    expect(getServer(deps, `a`)?.status).not.toBe(`disabled`)
  })

  it(`returns ok=false for unknown server`, () => {
    const deps = makeDeps()
    expect(disableServer(deps, `missing`).ok).toBe(false)
    expect(enableServer(deps, `missing`).ok).toBe(false)
  })
})

describe(`deleteCredentials`, () => {
  it(`clears apiKey vault entry and disables server`, async () => {
    const deps = makeDeps()
    await deps.vault.set(`vault://gh/token`, `secret`)
    await deps.registry.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `apiKey`,
            headerName: `X`,
            valueRef: `vault://gh/token`,
          },
        },
      },
    })
    const r = await deleteCredentials(deps, `gh`)
    expect(r.ok).toBe(true)
    expect(await deps.vault.get(`vault://gh/token`)).toBeNull()
    expect(getServer(deps, `gh`)?.status).toBe(`disabled`)
  })

  it(`clears clientCredentials vault entries`, async () => {
    const deps = makeDeps()
    await deps.vault.set(`vault://gh/cid`, `id`)
    await deps.vault.set(`vault://gh/secret`, `s`)
    await deps.registry.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `clientCredentials`,
            clientIdRef: `vault://gh/cid`,
            clientSecretRef: `vault://gh/secret`,
            tokenUrl: `http://t`,
          },
        },
      },
    })
    await deleteCredentials(deps, `gh`)
    expect(await deps.vault.get(`vault://gh/cid`)).toBeNull()
    expect(await deps.vault.get(`vault://gh/secret`)).toBeNull()
    expect(getServer(deps, `gh`)?.status).toBe(`disabled`)
  })

  it(`disables authorizationCode servers without touching the vault`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: { mode: `authorizationCode`, flow: `browser` },
        },
      },
    })
    const r = await deleteCredentials(deps, `gh`)
    expect(r.ok).toBe(true)
    expect(getServer(deps, `gh`)?.status).toBe(`disabled`)
  })

  it(`is a no-op for stdio servers (just disables)`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { s: { transport: `stdio`, command: `echo` } },
    })
    const r = await deleteCredentials(deps, `s`)
    expect(r.ok).toBe(true)
    expect(getServer(deps, `s`)?.status).toBe(`disabled`)
  })

  it(`returns ok=false for unknown server`, async () => {
    const deps = makeDeps()
    expect((await deleteCredentials(deps, `missing`)).ok).toBe(false)
  })
})

describe(`handleStatusRequest`, () => {
  it(`dispatches GET /api/mcp/servers`, async () => {
    const deps = makeDeps()
    const out = await handleStatusRequest(deps, {
      method: `GET`,
      url: `/api/mcp/servers`,
    })
    expect(out?.status).toBe(200)
    expect(Array.isArray(out?.body)).toBe(true)
  })

  it(`ignores query string when matching the list path`, async () => {
    const deps = makeDeps()
    const out = await handleStatusRequest(deps, {
      method: `GET`,
      url: `/api/mcp/servers?foo=bar`,
    })
    expect(out?.status).toBe(200)
  })

  it(`dispatches GET /api/mcp/servers/:server`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    const out = await handleStatusRequest(deps, {
      method: `GET`,
      url: `/api/mcp/servers/a`,
    })
    expect(out?.status).toBe(200)
    expect((out?.body as { name: string }).name).toBe(`a`)
  })

  it(`returns 404 for unknown server`, async () => {
    const deps = makeDeps()
    const out = await handleStatusRequest(deps, {
      method: `GET`,
      url: `/api/mcp/servers/missing`,
    })
    expect(out?.status).toBe(404)
  })

  it(`dispatches POST /api/mcp/servers/:server/disable`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    const out = await handleStatusRequest(deps, {
      method: `POST`,
      url: `/api/mcp/servers/a/disable`,
    })
    expect(out?.status).toBe(200)
    expect(getServer(deps, `a`)?.status).toBe(`disabled`)
  })

  it(`dispatches POST /api/mcp/servers/:server/enable`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    deps.registry.disable(`a`)
    const out = await handleStatusRequest(deps, {
      method: `POST`,
      url: `/api/mcp/servers/a/enable`,
    })
    expect(out?.status).toBe(200)
    expect(getServer(deps, `a`)?.status).not.toBe(`disabled`)
  })

  it(`dispatches DELETE /api/mcp/servers/:server/credentials`, async () => {
    const deps = makeDeps()
    await deps.vault.set(`vault://gh/token`, `secret`)
    await deps.registry.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `apiKey`,
            headerName: `X`,
            valueRef: `vault://gh/token`,
          },
        },
      },
    })
    const out = await handleStatusRequest(deps, {
      method: `DELETE`,
      url: `/api/mcp/servers/gh/credentials`,
    })
    expect(out?.status).toBe(200)
    expect(await deps.vault.get(`vault://gh/token`)).toBeNull()
  })

  it(`returns null for unrelated paths so the caller can chain`, async () => {
    const deps = makeDeps()
    const out = await handleStatusRequest(deps, {
      method: `GET`,
      url: `/something/else`,
    })
    expect(out).toBeNull()
  })

  it(`returns null for unsupported method/action combinations`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    // GET on action endpoint: not handled.
    expect(
      await handleStatusRequest(deps, {
        method: `GET`,
        url: `/api/mcp/servers/a/disable`,
      })
    ).toBeNull()
    // POST on collection: not handled.
    expect(
      await handleStatusRequest(deps, {
        method: `POST`,
        url: `/api/mcp/servers`,
      })
    ).toBeNull()
  })
})

describe(`mountStatusRoutes`, () => {
  function fakeRes(): {
    res: {
      writeHead: (status: number, headers: Record<string, string>) => void
      end: (body: string) => void
    }
    captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    }
  } {
    const captured: {
      status?: number
      headers?: Record<string, string>
      body?: string
    } = {}
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        captured.status = status
        captured.headers = headers
      },
      end(body: string) {
        captured.body = body
      },
    }
    return { res, captured }
  }

  it(`writes a JSON response on a handled request`, async () => {
    const deps = makeDeps()
    await deps.registry.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    const mount = mountStatusRoutes(deps)
    const { res, captured } = fakeRes()
    const handled = await mount.handle(
      { method: `GET`, url: `/api/mcp/servers` } as any,
      res as any
    )
    expect(handled).toBe(true)
    expect(captured.status).toBe(200)
    expect(captured.headers?.[`content-type`]).toBe(
      `application/json; charset=utf-8`
    )
    const parsed = JSON.parse(captured.body!) as Array<{ name: string }>
    expect(parsed[0]!.name).toBe(`a`)
  })

  it(`returns false (does not write) for non-matching paths`, async () => {
    const deps = makeDeps()
    const mount = mountStatusRoutes(deps)
    let endCalled = false
    const fakeReq = { method: `GET`, url: `/something/else` } as any
    const fakeResObj = {
      writeHead() {
        throw new Error(`should not write`)
      },
      end() {
        endCalled = true
      },
    } as any
    const handled = await mount.handle(fakeReq, fakeResObj)
    expect(handled).toBe(false)
    expect(endCalled).toBe(false)
  })

  it(`writes 404 for unknown server detail`, async () => {
    const deps = makeDeps()
    const mount = mountStatusRoutes(deps)
    const { res, captured } = fakeRes()
    const handled = await mount.handle(
      { method: `GET`, url: `/api/mcp/servers/missing` } as any,
      res as any
    )
    expect(handled).toBe(true)
    expect(captured.status).toBe(404)
    expect(JSON.parse(captured.body!).error).toBe(`not found`)
  })
})
