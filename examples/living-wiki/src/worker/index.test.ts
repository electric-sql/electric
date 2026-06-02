import { describe, expect, it } from 'vitest'
import worker from './index'

const env = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://api.example.test`,
  ELECTRIC_CLOUD_API_TOKEN: `test-token`,
  ELECTRIC_AGENTS_SPACE_ID: `space_test`,
  ENABLE_SEEDED_DEMO: `true`,
} satisfies Record<string, string>

describe(`living wiki worker`, () => {
  it(`returns REST health JSON`, async () => {
    const request = new Request(`https://living-wiki.test/api/health`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      app: `living-wiki`,
      env: `test`,
      electricCloudConfigured: true,
      seededDemoEnabled: true,
    })
  })

  it(`returns 404 JSON for unknown API routes`, async () => {
    const request = new Request(`https://living-wiki.test/api/missing`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `Not found`,
    })
  })
})
