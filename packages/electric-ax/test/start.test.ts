import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  readDotEnvFile,
  resolveAnthropicApiKey,
  resolveComposeProjectName,
  resolveElectricAgentsPort,
  resolvePullWakeOwnerPrincipal,
  resolvePullWakeRunnerId,
  waitForElectricAgentsServer,
} from '../src/start'

const dockerComposeFull = readFileSync(
  fileURLToPath(new URL(`../docker-compose.full.yml`, import.meta.url)),
  `utf8`
)
const localAgentsServerPullPolicy = `\${ELECTRIC_AGENTS_SERVER_PULL_POLICY:-missing}`

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

describe(`resolvePullWakeRunnerId`, () => {
  it(`uses process env when present`, () => {
    expect(
      resolvePullWakeRunnerId({ ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID: `r1` }, {})
    ).toBe(`r1`)
  })

  it(`falls back to .env`, () => {
    expect(
      resolvePullWakeRunnerId({}, { ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID: `r2` })
    ).toBe(`r2`)
  })

  it(`derives a stable local runner id from the agents identity`, () => {
    expect(
      resolvePullWakeRunnerId(
        { ELECTRIC_AGENTS_IDENTITY: `Alice Smith@example.com` },
        {}
      )
    ).toBe(`builtin-alice-smith-example.com`)
  })

  it(`defaults when no identity is available`, () => {
    expect(resolvePullWakeRunnerId({}, {})).toBe(`builtin-agents`)
  })
})

describe(`resolvePullWakeOwnerPrincipal`, () => {
  it(`prefers the configured agents principal`, () => {
    expect(
      resolvePullWakeOwnerPrincipal(
        {
          ELECTRIC_AGENTS_PRINCIPAL: `service:svc-test`,
          ELECTRIC_AGENTS_IDENTITY: `a@example.com`,
        },
        {}
      )
    ).toBe(`/principal/service%3Asvc-test`)
  })

  it(`uses the agents identity when present`, () => {
    expect(
      resolvePullWakeOwnerPrincipal(
        { ELECTRIC_AGENTS_IDENTITY: `user:a@example.com` },
        {}
      )
    ).toBe(`/principal/user%3Aa%40example.com`)
  })

  it(`falls back to the local builtin owner`, () => {
    expect(resolvePullWakeOwnerPrincipal({}, {})).toBe(
      `/principal/system%3Abuiltin-agents`
    )
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

describe(`docker compose full stack config`, () => {
  it(`does not force-pull over a locally built agents-server image`, () => {
    expect(dockerComposeFull).toContain(
      `pull_policy: ${localAgentsServerPullPolicy}`
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

  it(`checks health below tenant path prefixes`, async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }))

    await waitForElectricAgentsServer(`http://agents.test/t/svc-123/v1`, {
      fetchImpl,
      timeoutMs: 100,
      intervalMs: 0,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      `http://agents.test/t/svc-123/v1/_electric/health`,
      expect.any(Object)
    )
  })
})
