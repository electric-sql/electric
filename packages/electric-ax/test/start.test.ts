import { describe, expect, it } from 'vitest'
import {
  readDotEnvFile,
  resolveAnthropicApiKey,
  resolveComposeProjectName,
  resolveElectricAgentsPort,
} from '../src/start'

describe(`resolveAnthropicApiKey`, () => {
  it(`prefers the explicit CLI option`, () => {
    const result = resolveAnthropicApiKey(
      { anthropicApiKey: `cli-key` },
      { ANTHROPIC_API_KEY: `env-key` },
      { ANTHROPIC_API_KEY: `file-key` }
    )

    expect(result).toBe(`cli-key`)
  })

  it(`falls back to process env`, () => {
    const result = resolveAnthropicApiKey(
      {},
      { ANTHROPIC_API_KEY: `env-key` },
      { ANTHROPIC_API_KEY: `file-key` }
    )

    expect(result).toBe(`env-key`)
  })

  it(`falls back to .env values`, () => {
    const result = resolveAnthropicApiKey(
      {},
      {},
      { ANTHROPIC_API_KEY: `file-key` }
    )

    expect(result).toBe(`file-key`)
  })

  it(`throws when no key is available`, () => {
    expect(() => resolveAnthropicApiKey({}, {}, {})).toThrow(
      /ANTHROPIC_API_KEY/
    )
  })
})

describe(`resolveElectricAgentsPort`, () => {
  it(`uses process env when present`, () => {
    expect(
      resolveElectricAgentsPort({ ELECTRIC_AGENTS_PORT: `5544` }, {})
    ).toBe(5544)
  })

  it(`falls back to .env`, () => {
    expect(
      resolveElectricAgentsPort({}, { ELECTRIC_AGENTS_PORT: `6655` })
    ).toBe(6655)
  })

  it(`defaults to 4437`, () => {
    expect(resolveElectricAgentsPort({}, {})).toBe(4437)
  })
})

describe(`resolveComposeProjectName`, () => {
  it(`uses the explicit override when provided`, () => {
    expect(
      resolveComposeProjectName(`/tmp/demo`, {
        ELECTRIC_AGENTS_COMPOSE_PROJECT: `custom-project`,
      })
    ).toBe(`custom-project`)
  })

  it(`derives a stable name from cwd`, () => {
    expect(resolveComposeProjectName(`/tmp/My Project`, {})).toBe(
      `electric-agents-my-project`
    )
  })
})

describe(`readDotEnvFile`, () => {
  it(`returns an empty object when .env is missing`, () => {
    expect(readDotEnvFile(`/tmp/definitely-missing-electric-ax-env`)).toEqual(
      {}
    )
  })
})
