import { describe, expect, it } from 'vitest'
import { expandEnv } from '../../src/config/env-expand'

describe(`expandEnv`, () => {
  const env = { GITHUB_TOKEN: `gh_abc`, WORKSPACE: `/repo` }
  it(`expands \${env:VAR}`, () => {
    expect(expandEnv(`Bearer \${env:GITHUB_TOKEN}`, env)).toBe(`Bearer gh_abc`)
  })
  it(`expands multiple`, () => {
    expect(expandEnv(`\${env:WORKSPACE}/\${env:GITHUB_TOKEN}`, env)).toBe(
      `/repo/gh_abc`
    )
  })
  it(`throws on missing`, () => {
    expect(() => expandEnv(`\${env:MISSING}`, env)).toThrow(/MISSING/)
  })
  it(`passes through plain strings`, () => {
    expect(expandEnv(`plain`, env)).toBe(`plain`)
  })
})
