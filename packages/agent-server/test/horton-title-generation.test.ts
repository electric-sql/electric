import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from '../src/server'
import { waitFor } from './test-utils'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  `horton title generation`,
  () => {
    let dsServer: DurableStreamTestServer
    let electricAgentsServer: ElectricAgentsServer
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
    }, 60_000)

    afterAll(async () => {
      await Promise.allSettled([electricAgentsServer.stop(), dsServer.stop()])
    }, 60_000)

    it(`sets tags.title after the first user message`, async () => {
      const id = `title-test-${Date.now()}`
      const entityUrl = `/horton/${id}`

      const spawnRes = await fetch(`${baseUrl}${entityUrl}`, {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({}),
      })
      expect(spawnRes.status).toBe(201)

      const sendRes = await fetch(`${baseUrl}${entityUrl}/send`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          from: `user`,
          payload: `Help me refactor the auth middleware in ./auth.ts`,
        }),
      })
      expect(sendRes.status).toBe(204)

      let title: unknown
      await waitFor(
        async () => {
          const res = await fetch(`${baseUrl}${entityUrl}`, { method: `GET` })
          if (res.status === 200) {
            const body = (await res.json()) as {
              tags?: { title?: unknown } | null
            }
            title = body.tags?.title
            return typeof title === `string` && title.length > 0
          }
          return false
        },
        60_000,
        100
      )

      expect(typeof title).toBe(`string`)
      expect((title as string).length).toBeGreaterThan(0)
      expect((title as string).length).toBeLessThanOrEqual(80)
    }, 90_000)
  }
)
