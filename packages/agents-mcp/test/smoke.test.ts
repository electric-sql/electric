import { describe, expect, it } from 'vitest'
import * as mcp from '../src/index'

describe(`package boots`, () => {
  it(`exports VERSION`, () => {
    expect(mcp.VERSION).toBeTypeOf(`string`)
  })
})
