import { describe, expect, it } from 'vitest'
import { bridgeResourceTools } from '../../src/bridge/resource-bridge'

describe(`bridgeResourceTools`, () => {
  it(`exposes list + read`, async () => {
    const invoked: any[] = []
    const tools = bridgeResourceTools({
      server: `gh`,
      invoke: async (s, method, args) => {
        invoked.push({ s, method, args })
        return method === `resources/list`
          ? { resources: [{ uri: `x://y` }] }
          : { contents: [{ uri: (args as { uri: string }).uri, text: `hi` }] }
      },
      timeoutMs: 30_000,
    })
    expect(tools.map((t) => t.name)).toEqual([
      `gh.list_resources`,
      `gh.read_resource`,
    ])
    const list = await tools[0].run({})
    expect((list as any).resources).toHaveLength(1)
    const read = await tools[1].run({ uri: `x://y` })
    expect((read as any).contents[0].text).toBe(`hi`)
  })
})
