import { describe, expect, it } from 'vitest'
import { createHttpTransport } from '../../src/transports/http'

describe(`http transport`, () => {
  it(`composes the Authorization header from the headerProvider`, async () => {
    let captured: Headers | undefined
    const t = createHttpTransport({
      name: `mock`,
      url: `http://127.0.0.1:9/mcp`,
      headerProvider: async () => ({
        name: `Authorization`,
        value: `Bearer test-key`,
      }),
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response(``, { status: 500 })
      },
    })
    await expect(t.connect()).rejects.toBeDefined()
    expect(captured?.get(`Authorization`)).toBe(`Bearer test-key`)
  })
})
