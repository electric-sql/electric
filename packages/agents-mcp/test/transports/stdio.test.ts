import { describe, expect, it } from 'vitest'
import { createStdioTransport } from '../../src/transports/stdio'

describe(`stdio transport`, () => {
  it(`exposes connect/close and client (null before connect)`, () => {
    const t = createStdioTransport({
      transport: `stdio`,
      command: `echo`,
      args: [],
    })
    expect(typeof t.connect).toBe(`function`)
    expect(typeof t.close).toBe(`function`)
    expect(t.client).toBeNull()
  })
})
