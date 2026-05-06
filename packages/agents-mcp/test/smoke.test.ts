import { describe, expect, it } from 'vitest'
import * as mcp from '../src/index'

describe(`package boots`, () => {
  it(`exports VERSION and EXPERIMENTAL`, () => {
    expect(mcp.VERSION).toBeTypeOf(`string`)
    expect(mcp.EXPERIMENTAL).toBe(true)
  })
})
