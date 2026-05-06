import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry, type Registry } from '../../src/registry'
import { createMcpTools } from '../../src/tools'
import { FIXTURE_PATH, defaultTransportFactory, noopVault } from '../helpers'

/**
 * End-to-end tests against a real MCP server fixture spawned as a stdio
 * subprocess. Exercises the full registry → bridge → tool path: applyConfig
 * starts a child `tsx <fixture>`, eagerConnect runs the SDK initialize +
 * listTools/listResources/listPrompts handshake, and the bridge maps each
 * MCP tool/resource/prompt into a `BridgedTool`.
 *
 * Subprocess startup is slow on CI (~1s per spawn), so each test that
 * spawns its own registry passes a longer per-test timeout.
 */
describe(`E2E: stdio mock server`, () => {
  let registry: Registry

  beforeAll(async () => {
    registry = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    await registry.applyConfig({
      servers: {
        mock: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `default`],
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

  it(`echo round-trip`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const echo = tools.find((t) => t.name === `mock.echo`)!
    const result = await echo.run({ msg: `hello` })
    expect(result).toMatchObject({
      content: [{ type: `text`, text: `hello` }],
    })
  })

  it(`add round-trip`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const add = tools.find((t) => t.name === `mock.add`)!
    expect(await add.run({ a: 2, b: 3 })).toMatchObject({
      content: [{ type: `text`, text: `5` }],
    })
  })

  it(`lists resources`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const list = tools.find((t) => t.name === `mock.list_resources`)!
    const r = (await list.run({})) as { resources: Array<{ uri: string }> }
    expect(r.resources.length).toBeGreaterThan(0)
  })

  it(`reads a resource`, async () => {
    const tools = createMcpTools(registry, [`mock`]).tools()
    const read = tools.find((t) => t.name === `mock.read_resource`)!
    const r = (await read.run({ uri: `mock://config.json` })) as {
      contents: Array<{ text: string }>
    }
    expect(r.contents[0].text).toContain(`hello`)
  })

  it(`returns timeout error on slow scenario`, async () => {
    const slowReg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    await slowReg.applyConfig({
      servers: {
        slow: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `slow`],
        },
      },
    })
    try {
      const tools = createMcpTools(slowReg, [`slow`], {
        timeoutMs: 10,
      }).tools()
      const echo = tools.find((t) => t.name === `slow.echo`)!
      const r = (await echo.run({ msg: `x` })) as {
        error?: { kind: string; server: string }
      }
      expect(r.error).toMatchObject({ kind: `timeout`, server: `slow` })
    } finally {
      for (const s of slowReg.list()) {
        try {
          await s.transport?.close()
        } catch {
          // best-effort teardown
        }
      }
    }
  }, 30_000)

  it(`returns server_error on error scenario`, async () => {
    const errReg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    await errReg.applyConfig({
      servers: {
        err: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `error`],
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
    }
  }, 30_000)

  it(`hot-reload picks up new server`, async () => {
    const hrReg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    await hrReg.applyConfig({
      servers: {
        a: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `default`],
        },
      },
    })
    expect(hrReg.list().some((s) => s.name === `a`)).toBe(true)
    await hrReg.applyConfig({
      servers: {
        a: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `default`],
        },
        b: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `default`],
        },
      },
    })
    expect(hrReg.list().some((s) => s.name === `b`)).toBe(true)
    for (const s of hrReg.list()) {
      try {
        await s.transport?.close()
      } catch {
        // best-effort teardown
      }
    }
  }, 60_000)

  it(`progress notifications fire during a tool call`, async () => {
    const pReg = createRegistry({
      vault: noopVault(),
      transportFactory: defaultTransportFactory,
    })
    await pReg.applyConfig({
      servers: {
        p: {
          transport: `stdio`,
          command: `npx`,
          args: [`tsx`, FIXTURE_PATH, `progress`],
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
    }
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.server === `p`)).toBe(true)
  }, 30_000)
})
