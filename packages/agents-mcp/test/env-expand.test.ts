import { describe, expect, it } from 'vitest'
import { expandEnvVars, expandConfigValues } from '../src/config/env-expand'

describe(`expandEnvVars`, () => {
  it(`expands \${VAR} with env value`, () => {
    const result = expandEnvVars(`hello \${MY_VAR} world`, { MY_VAR: `test` })
    expect(result).toBe(`hello test world`)
  })

  it(`expands \${VAR:-default} to default when var missing`, () => {
    const result = expandEnvVars(`\${MISSING:-fallback}`, {})
    expect(result).toBe(`fallback`)
  })

  it(`expands \${VAR:-default} to var value when present`, () => {
    const result = expandEnvVars(`\${MY_VAR:-fallback}`, { MY_VAR: `actual` })
    expect(result).toBe(`actual`)
  })

  it(`throws when required var is missing (no default)`, () => {
    expect(() => expandEnvVars(`\${REQUIRED_VAR}`, {})).toThrow(/REQUIRED_VAR/)
  })

  it(`handles multiple expansions in one string`, () => {
    const result = expandEnvVars(`\${A}-\${B}`, { A: `1`, B: `2` })
    expect(result).toBe(`1-2`)
  })

  it(`returns strings without variables unchanged`, () => {
    expect(expandEnvVars(`plain text`, {})).toBe(`plain text`)
  })

  it(`expands empty string default`, () => {
    const result = expandEnvVars(`\${X:-}`, {})
    expect(result).toBe(``)
  })
})

describe(`expandConfigValues`, () => {
  it(`recursively expands env vars in an object`, () => {
    const config = {
      command: `npx`,
      env: { TOKEN: `\${GH_TOKEN}` },
      url: `https://\${HOST:-localhost}:3000`,
    }
    const result = expandConfigValues(config, { GH_TOKEN: `abc` })
    expect(result).toEqual({
      command: `npx`,
      env: { TOKEN: `abc` },
      url: `https://localhost:3000`,
    })
  })

  it(`does not expand non-string values`, () => {
    const config = { enabled: true, timeout: 5000 }
    expect(expandConfigValues(config, {})).toEqual(config)
  })
})
