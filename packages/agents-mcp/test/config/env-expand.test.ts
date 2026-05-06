import { describe, expect, it } from 'vitest'
import { expandEnv } from '../../src/config/env-expand'

describe(`expandEnv`, () => {
  const env = { GITHUB_TOKEN: `gh_abc`, WORKSPACE: `/repo`, EMPTY: `` }
  it(`expands \${env:VAR}`, () => {
    expect(expandEnv(`Bearer \${env:GITHUB_TOKEN}`, env)).toBe(`Bearer gh_abc`)
  })
  it(`expands multiple`, () => {
    expect(expandEnv(`\${env:WORKSPACE}/\${env:GITHUB_TOKEN}`, env)).toBe(
      `/repo/gh_abc`
    )
  })
  it(`expands the same var twice`, () => {
    expect(expandEnv(`\${env:GITHUB_TOKEN}-\${env:GITHUB_TOKEN}`, env)).toBe(
      `gh_abc-gh_abc`
    )
  })
  it(`substitutes empty values without throwing`, () => {
    expect(expandEnv(`a\${env:EMPTY}b`, env)).toBe(`ab`)
  })
  it(`throws on missing`, () => {
    expect(() => expandEnv(`\${env:MISSING}`, env)).toThrow(/MISSING/)
  })
  it(`throws on lowercase placeholder`, () => {
    expect(() => expandEnv(`\${env:my_var}`, env)).toThrow(/Invalid env var/)
  })
  it(`throws on empty placeholder`, () => {
    expect(() => expandEnv(`\${env:}`, env)).toThrow(/Invalid env var/)
  })
  it(`passes through plain strings`, () => {
    expect(expandEnv(`plain`, env)).toBe(`plain`)
  })
})
