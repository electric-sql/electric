import { describe, expect, it, vi } from 'vitest'
import {
  readDotEnvFile,
  resolveAnthropicApiKey,
  resolveBuiltinAgentsHost,
  resolveBuiltinAgentsPort,
  resolveComposeProjectName,
  resolveElectricAgentsPort,
  waitForElectricAgentsServer,
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

describe(`resolveBuiltinAgentsPort`, () => {
  it(`uses process env when present`, () => {
    expect(
      resolveBuiltinAgentsPort({ ELECTRIC_AGENTS_BUILTIN_PORT: `5548` }, {})
    ).toBe(5548)
  })

  it(`falls back to .env`, () => {
    expect(
      resolveBuiltinAgentsPort({}, { ELECTRIC_AGENTS_BUILTIN_PORT: `6658` })
    ).toBe(6658)
  })

  it(`defaults to 4448`, () => {
    expect(resolveBuiltinAgentsPort({}, {})).toBe(4448)
  })
})

describe(`resolveBuiltinAgentsHost`, () => {
  it(`uses process env when present`, () => {
    expect(
      resolveBuiltinAgentsHost(
        { ELECTRIC_AGENTS_BUILTIN_HOST: `127.0.0.1` },
        {}
      )
    ).toBe(`127.0.0.1`)
  })

  it(`falls back to .env`, () => {
    expect(
      resolveBuiltinAgentsHost(
        {},
        { ELECTRIC_AGENTS_BUILTIN_HOST: `localhost` }
      )
    ).toBe(`localhost`)
  })

  it(`defaults to all interfaces so Docker can reach the host runtime`, () => {
    expect(resolveBuiltinAgentsHost({}, {})).toBe(`0.0.0.0`)
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

  it(`defaults to the global project name`, () => {
    expect(resolveComposeProjectName(`/tmp/My Project`, {})).toBe(
      `electric-agents`
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

describe(`waitForElectricAgentsServer`, () => {
  it(`retries until the health endpoint responds`, async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(`fetch failed`))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))

    await waitForElectricAgentsServer(`http://localhost:4437`, {
      fetchImpl,
      timeoutMs: 100,
      intervalMs: 0,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl).toHaveBeenLastCalledWith(
      `http://localhost:4437/_electric/health`,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    )
  })
})
