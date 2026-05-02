import { describe, expect, it } from 'vitest'
import { convertKindMessageSchema } from '../../src/entity/messages'

describe(`convertKindMessageSchema`, () => {
  it(`accepts a valid claude→codex payload`, () => {
    const r = convertKindMessageSchema.safeParse({ kind: `codex` })
    expect(r.success).toBe(true)
  })

  it(`accepts payload with optional model`, () => {
    const r = convertKindMessageSchema.safeParse({
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    expect(r.success).toBe(true)
  })

  it(`rejects an unknown kind`, () => {
    const r = convertKindMessageSchema.safeParse({ kind: `gemini` })
    expect(r.success).toBe(false)
  })

  it(`rejects missing kind`, () => {
    const r = convertKindMessageSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})
