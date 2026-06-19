import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getCronStreamPath } from '@electric-ax/agents-runtime'
import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from '../src/server'
import {
  durableStreamTestServerUrl,
  readStreamEvents,
  waitFor,
} from './test-utils'
import { configureElectricAgentsTestBackendEnv } from './test-backend-env'

configureElectricAgentsTestBackendEnv(`agent-server-scheduler`, 20)

let TEST_ELECTRIC_URL = ``
let TEST_POSTGRES_URL = ``
let resetElectricAgentsTestBackend: () => Promise<void>

describe(`Scheduler Integration`, () => {
  let dsServer: DurableStreamTestServer
  let electricAgentsServer: ElectricAgentsServer | null = null
  let baseUrl = ``
  let streamBaseUrl = ``

  async function startElectricAgentsServer(): Promise<void> {
    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: durableStreamTestServerUrl(dsServer.url),
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    baseUrl = await electricAgentsServer.start()
    streamBaseUrl = electricAgentsServer.streamClient.baseUrl
  }

  async function stopElectricAgentsServer(): Promise<void> {
    if (!electricAgentsServer) return
    await electricAgentsServer.stop()
    electricAgentsServer = null
    baseUrl = ``
    streamBaseUrl = ``
  }

  async function createEntity(
    typeName: string,
    instanceId: string
  ): Promise<{
    url: string
    streams: { main: string }
  }> {
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `${typeName} test type`,
      }),
    })
    expect(typeRes.status).toBe(201)

    const entityRes = await fetch(
      `${baseUrl}/_electric/entities/${typeName}/${instanceId}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({}),
      }
    )
    expect(entityRes.status).toBe(201)

    const entity = (await entityRes.json()) as {
      url: string
      streams: { main: string }
    }

    return entity
  }

  async function registerEntityType(opts: {
    name: string
    description: string
  }): Promise<Response> {
    return await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(opts),
    })
  }

  beforeAll(async () => {
    const backend = await import(`./test-backend`)
    TEST_ELECTRIC_URL = backend.TEST_ELECTRIC_URL
    TEST_POSTGRES_URL = backend.TEST_POSTGRES_URL
    resetElectricAgentsTestBackend = backend.resetElectricAgentsTestBackend

    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    await Promise.all([resetElectricAgentsTestBackend(), dsServer.start()])
    await startElectricAgentsServer()
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([stopElectricAgentsServer(), dsServer.stop()])
  }, 120_000)

  it(`delayed_send survives server restart and lands exactly once`, async () => {
    const typeName = `sched-delay-${Date.now()}`
    const entity = await createEntity(typeName, `target`)

    const sendRes = await fetch(
      `${baseUrl}/_electric/entities${entity.url}/send`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          payload: `hello later`,
          afterMs: 750,
        }),
      }
    )
    expect(sendRes.status).toBe(204)

    await stopElectricAgentsServer()
    await startElectricAgentsServer()
    await waitFor(
      async () => {
        const events = await readStreamEvents(
          streamBaseUrl,
          entity.streams.main
        )
        return events.some((event) => event.type === `inbox`)
      },
      6_000,
      150
    )

    const events = await readStreamEvents(streamBaseUrl, entity.streams.main)
    const inboxEvents = events.filter((event) => event.type === `inbox`)

    expect(inboxEvents, JSON.stringify(events, null, 2)).toHaveLength(1)
    expect(inboxEvents[0]!.key).toMatch(/^scheduled-task-\d+$/)
    expect((inboxEvents[0]!.value as Record<string, unknown>).from).toBe(
      `/principal/system%3Adev-local`
    )
    expect((inboxEvents[0]!.value as Record<string, unknown>).payload).toBe(
      `hello later`
    )
  }, 20_000)

  it(`re-registering an entity type after restart updates it instead of failing`, async () => {
    const typeName = `sched-type-upsert-${Date.now()}`

    const first = await registerEntityType({
      name: typeName,
      description: `initial description`,
    })
    expect(first.status).toBe(201)
    const created = (await first.json()) as {
      name: string
      description: string
      revision: number
      created_at: string
      updated_at: string
    }
    expect(created.description).toBe(`initial description`)
    expect(created.revision).toBe(1)

    await stopElectricAgentsServer()
    await startElectricAgentsServer()

    const second = await registerEntityType({
      name: typeName,
      description: `updated description`,
    })
    expect(second.status).toBe(201)
    const updated = (await second.json()) as {
      name: string
      description: string
      revision: number
      created_at: string
      updated_at: string
    }

    expect(updated.description).toBe(`updated description`)
    expect(updated.revision).toBe(2)
    expect(updated.created_at).toBe(created.created_at)
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(
      Date.parse(created.updated_at)
    )
  }, 20_000)

  it(`manifest future_send updates replace pending task and settle to sent`, async () => {
    const typeName = `sched-manifest-send-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)
    const manifestKey = `schedule:demo-send`

    const firstRes = await fetch(
      `${baseUrl}/_electric/entities${entity.url}/schedules/${encodeURIComponent(`demo-send`)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          scheduleType: `future_send`,
          fireAt: new Date(Date.now() + 2_000).toISOString(),
          targetUrl: entity.url,
          payload: { body: `old payload` },
        }),
      }
    )
    expect(firstRes.status).toBe(200)

    const secondRes = await fetch(
      `${baseUrl}/_electric/entities${entity.url}/schedules/${encodeURIComponent(`demo-send`)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          scheduleType: `future_send`,
          fireAt: new Date(Date.now() + 600).toISOString(),
          targetUrl: entity.url,
          payload: { body: `new payload` },
        }),
      }
    )
    expect(secondRes.status).toBe(200)

    await waitFor(
      async () => {
        const events = await readStreamEvents(
          streamBaseUrl,
          entity.streams.main
        )
        const hasDeliveredMessage = events.some(
          (event) =>
            event.type === `inbox` &&
            (event.value as Record<string, unknown> | undefined)?.payload &&
            (
              (event.value as Record<string, unknown>).payload as Record<
                string,
                unknown
              >
            ).body === `new payload`
        )
        const latestManifest = events
          .filter(
            (event) => event.type === `manifest` && event.key === manifestKey
          )
          .at(-1)?.value as Record<string, unknown> | undefined
        return hasDeliveredMessage && latestManifest?.status === `sent`
      },
      6_000,
      150
    )

    const events = await readStreamEvents(streamBaseUrl, entity.streams.main)
    const inboxEvents = events.filter((event) => event.type === `inbox`)
    expect(inboxEvents, JSON.stringify(events, null, 2)).toHaveLength(1)
    expect(
      (
        (inboxEvents[0]!.value as Record<string, unknown>).payload as Record<
          string,
          unknown
        >
      ).body
    ).toBe(`new payload`)

    const manifestEvents = events.filter(
      (event) => event.type === `manifest` && event.key === manifestKey
    )
    const finalManifest = manifestEvents.at(-1)?.value as
      | Record<string, unknown>
      | undefined
    expect(finalManifest?.status).toBe(`sent`)
    expect(finalManifest?.sentAt).toEqual(expect.any(String))
  }, 20_000)

  it(`manifest cron schedules create wake events from cron ticks`, async () => {
    const typeName = `sched-manifest-cron-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)
    const expression = `*/1 * * * * *`
    const timezone = `America/Denver`
    const sourceUrl = getCronStreamPath(expression, timezone)

    const scheduleRes = await fetch(
      `${baseUrl}/_electric/entities${entity.url}/schedules/${encodeURIComponent(`demo-cron`)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          scheduleType: `cron`,
          expression,
          timezone,
          payload: { kind: `tick` },
        }),
      }
    )
    expect(scheduleRes.status, await scheduleRes.clone().text()).toBe(200)

    await waitFor(
      async () => {
        const events = await readStreamEvents(
          streamBaseUrl,
          entity.streams.main
        )
        return events.some(
          (event) =>
            event.type === `wake` &&
            (event.value as Record<string, unknown> | undefined)?.source ===
              sourceUrl
        )
      },
      6_000,
      150
    )

    const events = await readStreamEvents(streamBaseUrl, entity.streams.main)
    const wakeEvents = events.filter(
      (event) =>
        event.type === `wake` &&
        (event.value as Record<string, unknown> | undefined)?.source ===
          sourceUrl
    )
    expect(wakeEvents, JSON.stringify(events, null, 2)).toHaveLength(1)
  }, 20_000)
})
