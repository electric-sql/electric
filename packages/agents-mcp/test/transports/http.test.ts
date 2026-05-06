import { describe, expect, it } from 'vitest'
import { createHttpTransport } from '../../src/transports/http'

describe(`http transport`, () => {
  it(`exposes connect/close and client (null before connect)`, () => {
    const t = createHttpTransport(
      {
        transport: `http`,
        url: `http://x`,
        auth: { mode: `apiKey`, headerName: `X`, valueRef: `v` },
      },
      async () => `token`
    )
    expect(typeof t.connect).toBe(`function`)
    expect(typeof t.close).toBe(`function`)
    expect(t.client).toBeNull()
  })
})
