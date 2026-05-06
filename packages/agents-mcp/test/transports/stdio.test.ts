import { describe, expect, it } from 'vitest'
import { createStdioTransport } from '../../src/transports/stdio'

describe(`stdio transport`, () => {
  it(`exposes connect/send/close`, () => {
    const t = createStdioTransport({
      transport: `stdio`,
      command: `echo`,
      args: [],
    })
    expect(typeof t.connect).toBe(`function`)
    expect(typeof t.send).toBe(`function`)
    expect(typeof t.close).toBe(`function`)
  })
})
