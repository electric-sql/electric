import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry, type Registry } from '../../src/registry'
import { createMcpTools } from '../../src/tools'
import { defaultTransportFactory } from '../helpers'
import type { KeyVault } from '../../src/vault/types'
import {
  startMockHttpServer,
  type MockHttpServer,
} from '../fixtures/http-server'

/**
 * End-to-end tests against an in-process HTTP server that wraps the same mock
 * fixture used by the stdio E2E suite. Drives the registry → bridge →
 * SDK `StreamableHTTPClientTransport` path so we have defense-in-depth
 * coverage for the HTTP transport: the stdio E2E (Task 15g) covers the bridge
 * correctness; this suite confirms the HTTP wire format behaves the same way.
 *
 * The HTTP transport's auth header is resolved through the vault (apiKey
 * mode), so each test uses a vault that returns a fixed token — without it,
 * `resolveStatus` would mark the server `needs_auth` and skip eager-connect.
 */
function fixedKeyVault(value = `test-key`): KeyVault {
  return {
    get: async () => value,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  }
}

describe(`E2E: HTTP mock server`, () => {
  let server: MockHttpServer
  let registry: Registry

  beforeAll(async () => {
    server = await startMockHttpServer(`default`)
    registry = createRegistry({
      vault: fixedKeyVault(),
      transportFactory: defaultTransportFactory,
    })
    await registry.applyConfig({
      servers: {
        mock: {
          transport: `http`,
          url: server.url,
          auth: {
            mode: `apiKey`,
            headerName: `X-Test`,
            valueRef: `vault://test/key`,
          },
        },
      },
    })
  }, 30_000)

  afterAll(async () => {
    for (const s of registry.list()) {
      try {
        await s.transport?.close()
      } catch {
        // best-effort teardown
      }
    }
    await server.close()
  })

  it(`lists tools via mcp.tools(...)`, () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        `mock.echo`,
        `mock.add`,
        `mock.long`,
        `mock.list_resources`,
        `mock.read_resource`,
        `mock.list_prompts`,
        `mock.get_prompt`,
      ])
    )
  })

  it(`echo round-trip via HTTP`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const echo = tools.find((t) => t.name === `mock.echo`)!
    expect(await echo.run({ msg: `hello` })).toMatchObject({
      content: [{ type: `text`, text: `hello` }],
    })
  })

  it(`add round-trip via HTTP`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const add = tools.find((t) => t.name === `mock.add`)!
    expect(await add.run({ a: 2, b: 3 })).toMatchObject({
      content: [{ type: `text`, text: `5` }],
    })
  })

  it(`lists resources via HTTP`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const list = tools.find((t) => t.name === `mock.list_resources`)!
    const r = (await list.run({})) as { resources: Array<{ uri: string }> }
    expect(r.resources.length).toBeGreaterThan(0)
  })

  it(`reads a resource via HTTP`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const read = tools.find((t) => t.name === `mock.read_resource`)!
    const r = (await read.run({ uri: `mock://config.json` })) as {
      contents: Array<{ text: string }>
    }
    expect(r.contents[0].text).toContain(`hello`)
  })

  it(`returns server_error on error scenario`, async () => {
    const errServer = await startMockHttpServer(`error`)
    const errReg = createRegistry({
      vault: fixedKeyVault(),
      transportFactory: defaultTransportFactory,
    })
    await errReg.applyConfig({
      servers: {
        err: {
          transport: `http`,
          url: errServer.url,
          auth: {
            mode: `apiKey`,
            headerName: `X-Test`,
            valueRef: `vault://test/key`,
          },
        },
      },
    })
    try {
      const tools = createMcpTools(errReg, [`err`]).tools()
      const echo = tools.find((t) => t.name === `err.echo`)!
      const r = (await echo.run({ msg: `x` })) as { error?: unknown }
      expect(r.error).toBeDefined()
    } finally {
      for (const s of errReg.list()) {
        try {
          await s.transport?.close()
        } catch {
          // best-effort teardown
        }
      }
      await errServer.close()
    }
  }, 30_000)

  it(`progress notifications fire during a tool call`, async () => {
    const pServer = await startMockHttpServer(`progress`)
    const pReg = createRegistry({
      vault: fixedKeyVault(),
      transportFactory: defaultTransportFactory,
    })
    await pReg.applyConfig({
      servers: {
        p: {
          transport: `http`,
          url: pServer.url,
          auth: {
            mode: `apiKey`,
            headerName: `X-Test`,
            valueRef: `vault://test/key`,
          },
        },
      },
    })
    const events: Array<{ server: string }> = []
    const unsub = pReg.subscribeToProgress((e) =>
      events.push(e as { server: string })
    )
    try {
      const tools = createMcpTools(pReg, [`p`]).tools()
      await tools.find((t) => t.name === `p.long`)!.run({})
    } finally {
      unsub()
      for (const s of pReg.list()) {
        try {
          await s.transport?.close()
        } catch {
          // best-effort teardown
        }
      }
      await pServer.close()
    }
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.server === `p`)).toBe(true)
  }, 30_000)
})
