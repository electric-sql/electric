import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe(`progress passthrough`, () => {
  it(`forwards progress notifications to the optional callback`, async () => {
    const callTool = vi.fn(
      async (
        _args: unknown,
        _resultSchema: unknown,
        opts: { onProgress?: (p: unknown) => void }
      ) => {
        opts.onProgress?.({ progress: 0.5 })
        return { content: [{ type: `text`, text: `done` }] }
      }
    )
    const onProgress = vi.fn()
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `long`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 1000,
      onProgress,
    })
    await tool.call({})
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.5 })
  })
})
