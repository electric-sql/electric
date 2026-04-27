import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from '../src/server'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

describe(`entity lifecycle`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let electricAgentsServer: ElectricAgentsServer | null = null
  let baseUrl = ``

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])

    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    baseUrl = await electricAgentsServer.start()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  it(`killed entities remain readable with stopped status`, async () => {
    const createTypeResponse = await fetch(
      `${baseUrl}/_electric/entity-types`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          name: `task`,
          description: `Task entity`,
        }),
      }
    )
    expect(createTypeResponse.ok).toBe(true)

    const spawnResponse = await fetch(`${baseUrl}/task/demo-1`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(spawnResponse.status).toBe(201)

    const killResponse = await fetch(`${baseUrl}/task/demo-1`, {
      method: `DELETE`,
    })
    expect(killResponse.status).toBe(200)

    const getResponse = await fetch(`${baseUrl}/task/demo-1`)
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toMatchObject({
      url: `/task/demo-1`,
      type: `task`,
      status: `stopped`,
    })

    const headResponse = await fetch(`${baseUrl}/task/demo-1`, {
      method: `HEAD`,
    })
    expect(headResponse.status).toBe(200)
  })
})
