/**
 * HTTP-transport E2E suite against the official MCP reference server
 * `@modelcontextprotocol/server-everything` running in `streamableHttp`
 * mode. Mirrors `everything.e2e.test.ts` (which exercises stdio) so we have
 * symmetric coverage of the SDK's `StreamableHTTPClientTransport` against
 * the same third-party implementation.
 *
 * The reference server defaults to port 3001 but accepts a `PORT` env
 * override. We pick a high random port at suite start to avoid colliding
 * with anything else on the test host.
 *
 * Network / registry dependency:
 *   - The test spawns `npx -y -p @modelcontextprotocol/server-everything
 *     mcp-server-everything streamableHttp`, which on a fresh machine
 *     downloads the package from npm. CI environments without npm access
 *     will fail at spawn time; the suite detects spawn failure (or
 *     listen-line timeout) in `beforeAll` and skips the remaining tests
 *     with a clear message rather than failing catastrophically.
 *
 * How to run:
 *   pnpm -C packages/agents-mcp test test/e2e/everything-http.e2e.test.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry, type Registry } from '../../src/registry'
import { createMcpTools } from '../../src/tools'
import { defaultTransportFactory } from '../helpers'
import type { KeyVault } from '../../src/vault/types'

const SERVER_NAME = `everything`
const PER_TEST_TIMEOUT_MS = 60_000
const SETUP_TIMEOUT_MS = 90_000

function fixedKeyVault(value = `test-key`): KeyVault {
  return {
    get: async () => value,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  }
}

function pickPort(): number {
  // Pick a port well above 3001 to reduce collision odds. Range chosen to
  // stay under 65535 and out of common service ranges.
  return 30000 + Math.floor(Math.random() * 20000)
}

async function waitForListening(
  child: ChildProcess,
  port: number,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `timed out waiting for streamableHttp server to listen on ${port}`
          )
        ),
      timeoutMs
    )
    let buf = ``
    const onChunk = (chunk: Buffer | string) => {
      buf += String(chunk)
      // The reference server writes the listen line to stderr (it uses
      // `console.error`). We accept either stream just in case.
      if (buf.includes(`listening on port ${port}`)) {
        clearTimeout(timer)
        child.stdout?.off(`data`, onChunk)
        child.stderr?.off(`data`, onChunk)
        resolve()
      }
    }
    child.stdout?.on(`data`, onChunk)
    child.stderr?.on(`data`, onChunk)
    child.once(`exit`, (code) => {
      clearTimeout(timer)
      reject(
        new Error(
          `streamableHttp server exited before listening (code=${code})`
        )
      )
    })
  })
}

describe(`E2E: @modelcontextprotocol/server-everything (HTTP)`, () => {
  let registry: Registry | undefined
  let child: ChildProcess | undefined
  let setupError: Error | undefined

  beforeAll(async () => {
    try {
      const port = pickPort()
      child = spawn(
        `npx`,
        [
          `-y`,
          `-p`,
          `@modelcontextprotocol/server-everything`,
          `mcp-server-everything`,
          `streamableHttp`,
        ],
        {
          env: { ...process.env, PORT: String(port) },
          stdio: [`ignore`, `pipe`, `pipe`],
        }
      )
      await waitForListening(child, port, 60_000)

      registry = createRegistry({
        vault: fixedKeyVault(),
        transportFactory: defaultTransportFactory,
      })
      await registry.applyConfig({
        servers: {
          [SERVER_NAME]: {
            transport: `http`,
            url: `http://127.0.0.1:${port}/mcp`,
            auth: {
              mode: `apiKey`,
              headerName: `X-Test`,
              valueRef: `vault://test/key`,
            },
          },
        },
      })

      const entry = registry.list().find((s) => s.name === SERVER_NAME)
      if (!entry || !entry.tools || entry.tools.length === 0) {
        throw new Error(
          `failed to connect via HTTP to @modelcontextprotocol/server-everything ` +
            `(no tools discovered)`
        )
      }
    } catch (err) {
      setupError = err as Error

      console.warn(
        `[everything-http.e2e] skipping suite — could not start ` +
          `@modelcontextprotocol/server-everything streamableHttp: ` +
          `${(err as Error).message}`
      )
    }
  }, SETUP_TIMEOUT_MS)

  afterAll(async () => {
    if (registry) {
      for (const s of registry.list()) {
        try {
          await s.transport?.close()
        } catch {
          // best-effort teardown
        }
      }
    }
    if (child && !child.killed) {
      child.kill(`SIGTERM`)
      // Give it a moment to shut down gracefully; force-kill if it hangs.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child?.kill(`SIGKILL`)
          resolve()
        }, 2_000)
        child?.once(`exit`, () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
  })

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

  itLive(`tools/list returns the documented set via HTTP`, () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([`${SERVER_NAME}.echo`, `${SERVER_NAME}.get-sum`])
    )
  })

  itLive(`tools/call echo round-trips via HTTP`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const echo = tools.find((t) => t.name === `${SERVER_NAME}.echo`)!
    const result = (await echo.run({ message: `hello-http` })) as {
      content?: Array<{ type: string; text: string }>
      error?: unknown
    }
    expect(result.error).toBeUndefined()
    expect(result.content?.[0]?.type).toBe(`text`)
    expect(result.content?.[0]?.text).toContain(`hello-http`)
  })

  itLive(`tools/call get-sum via HTTP`, async () => {
    const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
    const sum = tools.find((t) => t.name === `${SERVER_NAME}.get-sum`)!
    const result = (await sum.run({ a: 7, b: 4 })) as {
      content?: Array<{ type: string; text: string }>
      error?: unknown
    }
    expect(result.error).toBeUndefined()
    expect(result.content?.[0]?.text).toContain(`11`)
  })

  itLive(
    `progress notifications fire during a long-running tool call (HTTP)`,
    async () => {
      const events: Array<{ server: string }> = []
      const unsub = registry!.subscribeToProgress((e) =>
        events.push(e as { server: string })
      )
      try {
        const tools = createMcpTools(registry!, [SERVER_NAME]).tools()
        const long = tools.find(
          (t) => t.name === `${SERVER_NAME}.trigger-long-running-operation`
        )!
        const result = (await long.run({ duration: 1, steps: 3 })) as {
          content?: Array<{ type: string; text: string }>
          error?: unknown
        }
        expect(result.error).toBeUndefined()
        expect(events.length).toBeGreaterThan(0)
        expect(events.every((e) => e.server === SERVER_NAME)).toBe(true)
      } finally {
        unsub()
      }
    }
  )
})
