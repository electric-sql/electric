import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from '../src/server'
import { waitForStreamEvents } from './test-utils'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  `horton spawn_worker round-trip`,
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

    it(`worker entity is created and Horton receives a runFinished wake from it`, async () => {
      const id = `spawn-test-${Date.now()}`
      const hortonUrl = `/horton/${id}`

      const spawnRes = await fetch(`${baseUrl}${hortonUrl}`, {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({}),
      })
      expect(spawnRes.status).toBe(201)
      const horton = (await spawnRes.json()) as {
        streams: { main: string }
      }

      const sendRes = await fetch(`${baseUrl}${hortonUrl}/send`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          from: `user`,
          payload:
            `Please use the spawn_worker tool RIGHT NOW to dispatch a worker ` +
            `with tools=["bash"] and a system prompt asking it to run ` +
            `\`echo $((2+2))\` and report the numeric result. End your turn ` +
            `after dispatching.`,
        }),
      })
      expect(sendRes.status).toBe(204)

      const events = await waitForStreamEvents(
        dsServer.url,
        horton.streams.main,
        (currentEvents) =>
          currentEvents.some((event) => {
            if (event.type !== `wake`) return false
            const finishedChild = (event.value as Record<string, unknown>)
              .finished_child
            return (
              typeof finishedChild === `object` &&
              finishedChild !== null &&
              typeof (finishedChild as Record<string, unknown>).url ===
                `string` &&
              (
                (finishedChild as Record<string, unknown>).url as string
              ).startsWith(`/worker/`)
            )
          }),
        180_000
      )
      const runFinishedWake = events.find((event) => {
        if (event.type !== `wake`) return false
        const finishedChild = (event.value as Record<string, unknown>)
          .finished_child
        return (
          typeof finishedChild === `object` &&
          finishedChild !== null &&
          typeof (finishedChild as Record<string, unknown>).url === `string` &&
          ((finishedChild as Record<string, unknown>).url as string).startsWith(
            `/worker/`
          )
        )
      })

      expect(
        runFinishedWake,
        `no runFinished wake from a worker arrived on horton's main stream within timeout`
      ).toBeDefined()

      const finishedChild = (runFinishedWake!.value as Record<string, unknown>)
        .finished_child as Record<string, unknown>
      expect(typeof finishedChild.url).toBe(`string`)
      expect(finishedChild.url as string).toMatch(
        /^\/worker\/[a-zA-Z0-9_-]{10,}$/
      )

      const response = finishedChild.response
      expect(typeof response).toBe(`string`)
      expect(response as string).toMatch(/\b4\b/)
    }, 240_000)
  }
)
