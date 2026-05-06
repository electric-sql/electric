import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

const PORT = 38421

async function waitFor(url: string, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { method: `GET` })
      if (res.status < 500) return
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server not ready: ${url}`)
}

// The @modelcontextprotocol/server-everything CLI accepts a positional transport
// argument ("streamableHttp") and reads the port from the PORT env variable.
// The plan assumed --transport=http --port=NNNN flags, but the actual CLI is:
//   node ./index.js streamableHttp
// with PORT set via environment.
describe(`E2E — everything server (HTTP)`, () => {
  let proc: ChildProcess

  beforeAll(async () => {
    proc = spawn(
      `npx`,
      [`-y`, `@modelcontextprotocol/server-everything`, `streamableHttp`],
      {
        stdio: `pipe`,
        env: { ...process.env, PORT: String(PORT) },
      }
    )
    await waitFor(`http://127.0.0.1:${PORT}/mcp`, 30_000)
  }, 60_000)

  afterAll(() => {
    proc?.kill(`SIGTERM`)
  })

  it(`connects via HTTP and lists tools`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const r = await reg.addServer({
      name: `everything-http`,
      transport: `http`,
      url: `http://127.0.0.1:${PORT}/mcp`,
      auth: { mode: `none` },
    })
    expect(r.state).toBe(`ready`)
    expect(reg.get(`everything-http`)?.tools.length).toBeGreaterThan(0)
    await reg.removeServer(`everything-http`)
  }, 60_000)

  it(`calls echo via HTTP`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: `everything-http`,
      transport: `http`,
      url: `http://127.0.0.1:${PORT}/mcp`,
      auth: { mode: `none` },
    })
    const entry = reg.get(`everything-http`)!
    const echoTool = entry.tools.find((t) => t.name === `echo`)!
    const tool = bridgeMcpTool({
      server: `everything-http`,
      tool: echoTool,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const out = (await tool.call({ message: `hello` })) as {
      content: Array<{ type: string; text: string }>
    }
    expect(out.content.some((c) => c.text.includes(`hello`))).toBe(true)
    await reg.removeServer(`everything-http`)
  }, 60_000)
})
