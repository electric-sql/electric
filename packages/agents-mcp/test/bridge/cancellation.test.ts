import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe(`cancellation`, () => {
  it(`aborts the SDK call when the caller-supplied signal aborts`, async () => {
    let abortedFromSdk = false
    const callTool = vi.fn(async (_args, o: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        o.signal?.addEventListener(`abort`, () => {
          abortedFromSdk = true
          reject(new Error(`aborted`))
        })
      })
    })
    const ctrl = new AbortController()
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `t`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 5000,
      signal: ctrl.signal,
    })
    const p = tool.call({})
    ctrl.abort()
    await expect(p).rejects.toBeDefined()
    expect(abortedFromSdk).toBe(true)
  })
})
