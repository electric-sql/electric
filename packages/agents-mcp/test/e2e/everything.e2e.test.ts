/**
 * E2E suite against the official MCP reference server
 * `@modelcontextprotocol/server-everything`.
 *
 * What this validates that the mock-server tests don't:
 *   - Protocol-level correctness against a real, third-party MCP
 *     implementation (not our hand-rolled fixture).
 *   - Compatibility with the latest published reference server, including
 *     real tool / prompt / resource shapes (e.g. dashed names like
 *     `get-sum`, `simple-prompt`, `demo://resource/static/document/...`).
 *   - Real progress notifications emitted by an external implementation.
 *
 * Network / registry dependency:
 *   - The test spawns `npx -y -p @modelcontextprotocol/server-everything
 *     mcp-server-everything`, which on a fresh machine downloads the
 *     package from npm. CI environments without npm-registry network
 *     access will fail at spawn time. The suite detects spawn failure in
 *     `beforeAll` and skips the remaining tests with a clear message
 *     rather than failing catastrophically.
 *
 * How to run:
 *   pnpm -C packages/agents-mcp test test/e2e/everything.e2e.test.ts
 *
 * Tool / prompt / resource names are taken from server-everything
 * `2026.1.26`. If you upgrade the server and names change, update the
 * assertions below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry, type Registry } from '../../src/registry'
import { createMcpTools } from '../../src/tools'
import { defaultTransportFactory, noopVault } from '../helpers'

const SERVER_NAME = `everything`
const PER_TEST_TIMEOUT_MS = 60_000
const SETUP_TIMEOUT_MS = 90_000

describe(`E2E: @modelcontextprotocol/server-everything`, () => {
  let registry: Registry | undefined
  let setupError: Error | undefined

  beforeAll(async () => {
    try {
      registry = createRegistry({
        vault: noopVault(),
        transportFactory: defaultTransportFactory,
      })
      await registry.applyConfig({
        servers: {
          [SERVER_NAME]: {
            transport: `stdio`,
            command: `npx`,
            args: [
              `-y`,
              `-p`,
              `@modelcontextprotocol/server-everything`,
              `mcp-server-everything`,
            ],
          },
        },
      })
      // Sanity check: confirm the registry connected and discovered tools.
      const entry = registry.list().find((s) => s.name === SERVER_NAME)
      if (!entry || !entry.tools || entry.tools.length === 0) {
        throw new Error(
          `failed to connect to @modelcontextprotocol/server-everything ` +
            `(no tools discovered) — likely no network access to npm`
        )
      }
    } catch (err) {
      setupError = err as Error

      console.warn(
        `[everything.e2e] skipping suite — could not spawn ` +
          `@modelcontextprotocol/server-everything: ${(err as Error).message}`
      )
    }
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    if (!registry) return
    for (const s of registry.list()) {
      try {
        await s.transport?.close()
      } catch {
        // best-effort teardown
      }
    }
  })

  // Helper that skips at runtime when setup failed (network unavailable).
  const itLive = (
    name: string,
    fn: () => void | Promise<void>,
    timeoutMs = PER_TEST_TIMEOUT_MS
  ) => {
    it(
      name,
      async (ctx) => {
        if (setupError || !registry) {
          ctx.skip()
          return
        }
        await fn()
      },
      timeoutMs
    )
  }

  itLive(`tools/list returns the documented set`, () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const names = tools.map((t) => t.name)
    // The reference server's headline tools at 2026.1.26.
    expect(names).toEqual(
      expect.arrayContaining([
        `mcp__${SERVER_NAME}__echo`,
        `mcp__${SERVER_NAME}__get-sum`,
        `mcp__${SERVER_NAME}__trigger-long-running-operation`,
        `mcp__${SERVER_NAME}__get-tiny-image`,
        `mcp__${SERVER_NAME}__get-env`,
      ])
    )
    // Bridged resource & prompt helpers are always present.
    expect(names).toEqual(
      expect.arrayContaining([
        `mcp__${SERVER_NAME}__list_resources`,
        `mcp__${SERVER_NAME}__read_resource`,
        `mcp__${SERVER_NAME}__list_prompts`,
        `mcp__${SERVER_NAME}__get_prompt`,
      ])
    )
  })

  itLive(`tools/call echo round-trips a string`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const echo = tools.find((t) => t.name === `mcp__${SERVER_NAME}__echo`)!
    const result = (await echo.run({ message: `hello-everything` })) as {
      content?: Array<{ type: string; text: string }>
      error?: unknown
    }
    expect(result.error).toBeUndefined()
    expect(result.content?.[0]?.type).toBe(`text`)
    expect(result.content?.[0]?.text).toContain(`hello-everything`)
  })

  itLive(`tools/call get-sum returns the sum of two numbers`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const sum = tools.find((t) => t.name === `mcp__${SERVER_NAME}__get-sum`)!
    const result = (await sum.run({ a: 2, b: 3 })) as {
      content?: Array<{ type: string; text: string }>
      error?: unknown
    }
    expect(result.error).toBeUndefined()
    expect(result.content?.[0]?.text).toContain(`5`)
  })

  itLive(
    `tools/call trigger-long-running-operation completes and emits progress`,
    async () => {
      const events: Array<{ server: string }> = []
      const unsub = registry!.subscribeToProgress((e) =>
        events.push(e as { server: string })
      )
      try {
        const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
        const long = tools.find(
          (t) =>
            t.name === `mcp__${SERVER_NAME}__trigger-long-running-operation`
        )!
        const result = (await long.run({ duration: 1, steps: 3 })) as {
          content?: Array<{ type: string; text: string }>
          error?: unknown
        }
        expect(result.error).toBeUndefined()
        expect(result.content?.[0]?.type).toBe(`text`)
        // Progress notifications: the server emits one per step.
        expect(events.length).toBeGreaterThan(0)
        expect(events.every((e) => e.server === SERVER_NAME)).toBe(true)
      } finally {
        unsub()
      }
    }
  )

  itLive(`resources/list returns at least one resource`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const list = tools.find(
      (t) => t.name === `mcp__${SERVER_NAME}__list_resources`
    )!
    const r = (await list.run({})) as {
      resources?: Array<{ uri: string }>
      error?: unknown
    }
    expect(r.error).toBeUndefined()
    expect(r.resources?.length ?? 0).toBeGreaterThan(0)
  })

  itLive(`resources/read returns contents for a listed resource`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const list = tools.find(
      (t) => t.name === `mcp__${SERVER_NAME}__list_resources`
    )!
    const read = tools.find(
      (t) => t.name === `mcp__${SERVER_NAME}__read_resource`
    )!
    const listed = (await list.run({})) as {
      resources: Array<{ uri: string }>
    }
    const uri = listed.resources[0]?.uri
    expect(uri).toBeDefined()
    const r = (await read.run({ uri })) as {
      contents?: Array<{ uri: string; text?: string; blob?: string }>
      error?: unknown
    }
    expect(r.error).toBeUndefined()
    expect(r.contents?.length ?? 0).toBeGreaterThan(0)
  })

  itLive(`prompts/list includes the documented prompts`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const list = tools.find(
      (t) => t.name === `mcp__${SERVER_NAME}__list_prompts`
    )!
    const r = (await list.run({})) as {
      prompts?: Array<{ name: string }>
      error?: unknown
    }
    expect(r.error).toBeUndefined()
    const names = (r.prompts ?? []).map((p) => p.name)
    // Real names in server-everything 2026.1.26 use dashes — note this
    // differs from the legacy server which used `simple_prompt` /
    // `complex_prompt`. Assert against actual current shape.
    expect(names).toEqual(expect.arrayContaining([`simple-prompt`]))
    // Prefer the multi-arg "args-prompt" or "completable-prompt" as the
    // moral equivalent of the old `complex_prompt`.
    expect(
      names.some(
        (n) =>
          n === `args-prompt` ||
          n === `completable-prompt` ||
          n === `resource-prompt`
      )
    ).toBe(true)
  })

  itLive(`prompts/get simple-prompt returns a messages array`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const get = tools.find((t) => t.name === `mcp__${SERVER_NAME}__get_prompt`)!
    const r = (await get.run({ name: `simple-prompt` })) as {
      messages?: Array<{ role: string; content: unknown }>
      error?: unknown
    }
    expect(r.error).toBeUndefined()
    expect(Array.isArray(r.messages)).toBe(true)
    expect((r.messages ?? []).length).toBeGreaterThan(0)
  })
})
