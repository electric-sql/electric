import { describe, expect, it } from 'vitest'
import { expandEnv } from '../src/config/env-expand'

describe(`expandEnv`, () => {
  it(`substitutes \${env:VAR}`, () => {
    expect(expandEnv(`\${env:HOME}/x`, { HOME: `/u/me` })).toBe(`/u/me/x`)
  })

  it(`leaves unknown vars empty and reports them`, () => {
    const { value, missing } = expandEnv.detailed(`\${env:NOPE}`, {})
    expect(value).toBe(``)
    expect(missing).toEqual([`NOPE`])
  })

  it(`passes through plain strings`, () => {
    expect(expandEnv(`plain`, {})).toBe(`plain`)
  })

  it(`expands inside nested object values`, () => {
    const out = expandEnv.deep(
      { a: `\${env:X}`, b: { c: [`\${env:Y}`, `z`] } },
      { X: `1`, Y: `2` }
    )
    expect(out).toEqual({ a: `1`, b: { c: [`2`, `z`] } })
  })
})
