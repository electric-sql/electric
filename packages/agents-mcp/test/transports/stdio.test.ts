import { describe, expect, it } from 'vitest'
import { createStdioTransport } from '../../src/transports/stdio'

describe(`stdio transport`, () => {
  it(`connects to the official everything server and lists tools`, async () => {
    const t = createStdioTransport({
      name: `everything`,
      command: `npx`,
      args: [`-y`, `@modelcontextprotocol/server-everything`],
    })
    await t.connect()
    try {
      const tools = await t.client.listTools()
      expect(tools.tools.length).toBeGreaterThan(0)
    } finally {
      await t.close()
    }
  }, 30_000)
})
