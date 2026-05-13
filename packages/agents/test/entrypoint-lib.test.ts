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

  test(`merges configured server headers and moves claim tokens out of authorization`, () => {
    const options = resolveBuiltinAgentsEntrypointOptions(
      {
        ELECTRIC_AGENTS_SERVER_URL: `http://localhost:4437`,
        PULL_WAKE_RUNNER_ID: `runner-1`,
        ELECTRIC_AGENTS_SERVER_HEADERS: JSON.stringify({
          Authorization: `Bearer tenant-token`,
          'X-Tenant': `tenant-1`,
        }),
      },
      `/tmp/project`
    )

    expect(options.pullWake.headers).toEqual({
      authorization: `Bearer tenant-token`,
      'x-tenant': `tenant-1`,
    })
    expect(options.pullWake.claimHeaders).toEqual(options.pullWake.headers)
    expect(options.pullWake.claimTokenHeader).toBe(`electric-claim-token`)
  })
})
