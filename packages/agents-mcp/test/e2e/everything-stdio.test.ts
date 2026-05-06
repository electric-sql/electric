import { describe, expect, it } from 'vitest'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'
import { buildResourceTools } from '../../src/bridge/resource-bridge'
import { buildPromptTools } from '../../src/bridge/prompt-bridge'

describe(`E2E — everything server (stdio)`, () => {
  it(`connects, lists tools, calls echo`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const result = await reg.addServer({
      name: `everything`,
      transport: `stdio`,
      command: `npx`,
      args: [`-y`, `@modelcontextprotocol/server-everything`],
    })
    expect(result.state).toBe(`ready`)
    const entry = reg.get(`everything`)!
    expect(entry.tools.length).toBeGreaterThan(0)

    const echoTool = entry.tools.find((t) => t.name === `echo`)
    expect(echoTool).toBeDefined()
    const tool = bridgeMcpTool({
      server: `everything`,
      tool: echoTool!,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const out = (await tool.call({ message: `hi` })) as {
      content: Array<{ type: string; text: string }>
    }
    expect(
      out.content.some((c) => c.type === `text` && c.text.includes(`hi`))
    ).toBe(true)

    await reg.removeServer(`everything`)
  }, 60_000)

  it(`lists resources and reads one`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: `everything`,
      transport: `stdio`,
      command: `npx`,
      args: [`-y`, `@modelcontextprotocol/server-everything`],
    })
    const entry = reg.get(`everything`)!
    const [list, read] = buildResourceTools({
      server: `everything`,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const listed = (await list!.call({})) as {
      resources: Array<{ uri: string }>
    }
    expect(listed.resources.length).toBeGreaterThan(0)
    const first = listed.resources[0]!
    const got = (await read!.call({ uri: first.uri })) as {
      contents: unknown[]
    }
    expect(got.contents.length).toBeGreaterThan(0)
    await reg.removeServer(`everything`)
  }, 60_000)

  it(`lists prompts and gets one`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: `everything`,
      transport: `stdio`,
      command: `npx`,
      args: [`-y`, `@modelcontextprotocol/server-everything`],
    })
    const entry = reg.get(`everything`)!
    const [list, get] = buildPromptTools({
      server: `everything`,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const listed = (await list!.call({})) as {
      prompts: Array<{ name: string }>
    }
    expect(listed.prompts.length).toBeGreaterThan(0)
    const first = listed.prompts[0]!
    const out = (await get!.call({ name: first.name })) as {
      messages: unknown[]
    }
    expect(out.messages.length).toBeGreaterThan(0)
    await reg.removeServer(`everything`)
  }, 60_000)

  it(`connection idempotency: re-adding the same config does not respawn the subprocess`, async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const cfg = {
      name: `everything`,
      transport: `stdio` as const,
      command: `npx`,
      args: [`-y`, `@modelcontextprotocol/server-everything`],
    }
    await reg.addServer(cfg)
    const transportBefore = reg.get(`everything`)?.transport
    await reg.addServer(cfg)
    const transportAfter = reg.get(`everything`)?.transport
    expect(transportAfter).toBe(transportBefore)
    await reg.removeServer(`everything`)
  }, 60_000)
})
