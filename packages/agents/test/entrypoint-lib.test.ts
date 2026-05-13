import { describe, expect, test } from 'vitest'
import { resolveBuiltinAgentsEntrypointOptions } from '../src/entrypoint-lib.js'

describe(`resolveBuiltinAgentsEntrypointOptions`, () => {
  test(`requires and passes through pull-wake runner id`, () => {
    const options = resolveBuiltinAgentsEntrypointOptions(
      {
        ELECTRIC_AGENTS_SERVER_URL: `http://localhost:4437`,
        ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID: `runner-1`,
      },
      `/tmp/project`
    )

    expect(options.pullWake.runnerId).toBe(`runner-1`)
    expect(options.pullWake.headers).toBeUndefined()
    expect(options.pullWake.claimHeaders).toBeUndefined()
  })

  test(`passes asserted auth headers to pull-wake and claim requests when set`, () => {
    const options = resolveBuiltinAgentsEntrypointOptions(
      {
        ELECTRIC_AGENTS_SERVER_URL: `http://localhost:4437`,
        PULL_WAKE_RUNNER_ID: `runner-1`,
        ELECTRIC_ASSERTED_AUTH_EMAIL: ` agent@example.test `,
        ELECTRIC_ASSERTED_AUTH_NAME: ` Agent User `,
      },
      `/tmp/project`
    )

    expect(options.pullWake.headers).toEqual({
      'x-electric-asserted-email': `agent@example.test`,
      'x-electric-asserted-name': `Agent User`,
    })
    expect(options.pullWake.claimHeaders).toEqual(options.pullWake.headers)
  })

  test(`merges configured server headers and moves claim tokens out of authorization`, () => {
    const options = resolveBuiltinAgentsEntrypointOptions(
      {
        ELECTRIC_AGENTS_SERVER_URL: `http://localhost:4437`,
        PULL_WAKE_RUNNER_ID: `runner-1`,
        ELECTRIC_ASSERTED_AUTH_EMAIL: `agent@example.test`,
        ELECTRIC_AGENTS_SERVER_HEADERS: JSON.stringify({
          Authorization: `Bearer tenant-token`,
          'X-Tenant': `tenant-1`,
        }),
      },
      `/tmp/project`
    )

    expect(options.pullWake.headers).toEqual({
      authorization: `Bearer tenant-token`,
      'x-electric-asserted-email': `agent@example.test`,
      'x-tenant': `tenant-1`,
    })
    expect(options.pullWake.claimHeaders).toEqual(options.pullWake.headers)
    expect(options.pullWake.claimTokenHeader).toBe(`electric-claim-token`)
  })
})
