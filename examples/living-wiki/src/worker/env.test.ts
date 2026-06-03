import { describe, expect, it } from 'vitest'
import { getAgentsRuntimeConfig, type WorkerEnv } from './env'

const baseEnv = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://api.example.test`,
  ELECTRIC_AGENTS_SPACE_ID: `space_test`,
} satisfies WorkerEnv

describe(`Agents runtime env config`, () => {
  it(`reports missing Agents runtime config without falling back to Electric Cloud URL`, () => {
    expect(getAgentsRuntimeConfig(baseEnv)).toEqual({
      configured: false,
      baseUrl: undefined,
      hasToken: false,
      hasPrincipalKey: false,
    })
  })

  it(`normalizes configured Agents runtime base URL and reports secret availability only`, () => {
    expect(
      getAgentsRuntimeConfig({
        ...baseEnv,
        ELECTRIC_AGENTS_BASE_URL: `https://agents.example.test/runtime/`,
        ELECTRIC_AGENTS_TOKEN: `agents-secret-token`,
        ELECTRIC_AGENTS_PRINCIPAL_KEY: `principal-secret-key`,
      })
    ).toEqual({
      configured: true,
      baseUrl: `https://agents.example.test/runtime`,
      hasToken: true,
      hasPrincipalKey: true,
    })
  })

  it(`rejects invalid Agents runtime base URLs`, () => {
    expect(() =>
      getAgentsRuntimeConfig({
        ...baseEnv,
        ELECTRIC_AGENTS_BASE_URL: `not a url`,
      })
    ).toThrow(`Invalid ELECTRIC_AGENTS_BASE_URL`)
  })
})
