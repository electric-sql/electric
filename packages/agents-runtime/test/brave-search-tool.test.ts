import { describe, expect, it } from 'vitest'
import { braveSearchTool } from '../src/tools'

describe(`braveSearchTool`, () => {
  it(`is exposed to agents as web_search`, () => {
    expect(braveSearchTool.name).toBe(`web_search`)
  })
})
