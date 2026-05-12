import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { BuiltinAgentsServer } from '../../agents/src/server'
import { ElectricAgentsServer } from '../src/server'
import { readStreamEvents, waitFor } from './test-utils'
import {
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'
import type { StreamFn } from '@mariozechner/pi-agent-core'

function createMockStreamFn(responseText: string): StreamFn {
  return vi.fn(((model) => {
    const message = {
      role: `assistant`,
      content: [{ type: `text`, text: responseText }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: `stop`,
      timestamp: Date.now(),
    } as any
    const events = [
      { type: `start`, partial: { ...message, content: [] } },
      {
        type: `text_start`,
        contentIndex: 0,
        partial: { ...message, content: [{ type: `text`, text: `` }] },
      },
      {
        type: `text_delta`,
        contentIndex: 0,
        delta: responseText,
        partial: message,
      },
      {
        type: `text_end`,
        contentIndex: 0,
        content: responseText,
        partial: message,
      },
      { type: `done`, reason: `stop`, message },
    ] as any[]

    return {
      async *[Symbol.asyncIterator]() {
        for (const event of events) yield event
      },
      result: async () => message,
    } as any
  }) as StreamFn)
}

function eventType(event: any): unknown {
  return event.type ?? event.value?.type ?? event.value?.value?.type
}

function assertCompleteResponses(
  events: Array<any>,
  responseText: string,
  minCount: number
): void {
  expect(
    events.filter((event) => eventType(event) === `run`).length
  ).toBeGreaterThanOrEqual(minCount)
  expect(
    events.filter((event) => eventType(event) === `step`).length
  ).toBeGreaterThanOrEqual(minCount)
  expect(
    events.filter((event) => eventType(event) === `text`).length
  ).toBeGreaterThanOrEqual(minCount)

  const responseDeltas = events
    .filter((event) => eventType(event) === `text_delta`)
    .map((event) => {
      const value = event.value?.value ?? event.value ?? event
      return typeof value.delta === `string` ? value.delta : ``
    })
    .join(``)
  expect(responseDeltas.split(responseText).length - 1).toBeGreaterThanOrEqual(
    minCount
  )
}

describe(`pull-wake Horton e2e with mocked LLM`, () => {
  let dsServer: DurableStreamTestServer
  let builtinAgentsServer: BuiltinAgentsServer
  let electricAgentsServer: ElectricAgentsServer
  let baseUrl = ``
  let streamBaseUrl = ``
  const runnerId = `horton-pull-wake-e2e-test`
  const authHeaders = { authorization: `Bearer test-token` }
  const mockResponse = `Mock Horton response: pull-wake dispatch was consumed.`
  const mockStreamFn = createMockStreamFn(mockResponse) as StreamFn & {
    mock: { calls: Array<unknown> }
  }

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
      electricUrl: undefined,
      authenticateRequest: (req) =>
        req.headers.get(`authorization`) === authHeaders.authorization
          ? { userId: `test-user` }
          : null,
    })
    baseUrl = await electricAgentsServer.start()
    streamBaseUrl = electricAgentsServer.streamClient.baseUrl
    builtinAgentsServer = new BuiltinAgentsServer({
      agentServerUrl: baseUrl,
      mockStreamFn,
      pullWake: {
        runnerId,
        registerRunner: true,
        ownerUserId: `test-user`,
        headers: authHeaders,
        claimHeaders: authHeaders,
        claimTokenHeader: `electric-claim-token`,
      },
    })
    await builtinAgentsServer.start()
  }, 60_000)

  afterAll(async () => {
    await Promise.allSettled([
      builtinAgentsServer?.stop(),
      electricAgentsServer?.stop(),
      dsServer?.stop(),
    ])
  }, 60_000)

  it(`dispatches explicit runner-policy wakes and Horton writes mocked responses`, async () => {
    const id = `pull-wake-horton-${Date.now()}`
    const entityUrl = `/horton/${id}`
    const entityApiUrl = `${baseUrl}/_electric/entities/horton/${id}`
    const dispatch_policy = { targets: [{ type: `runner`, runnerId }] }

    const runnerRes = await fetch(`${baseUrl}/_electric/runners/${runnerId}`, {
      headers: authHeaders,
    })
    expect(runnerRes.status).toBe(200)
    const runnerText = await runnerRes.text()
    const runner = JSON.parse(runnerText) as { wake_stream?: string }
    expect(runner.wake_stream).toBe(`/runners/${runnerId}/wake`)

    const spawnRes = await fetch(entityApiUrl, {
      method: `PUT`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({ dispatch_policy }),
    })
    expect(spawnRes.status).toBe(201)
    const spawned = (await spawnRes.json()) as {
      streams: { main: string }
      dispatch_policy?: unknown
    }
    expect(spawned.dispatch_policy).toEqual(dispatch_policy)

    const sendRes = await fetch(`${entityApiUrl}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({
        from: `user`,
        payload: `Please answer via pull-wake.`,
      }),
    })
    expect(sendRes.status).toBe(204)

    await waitFor(async () => mockStreamFn.mock.calls.length > 0, 20_000, 50)

    await waitFor(async () => {
      const events = await readStreamEvents(streamBaseUrl, spawned.streams.main)
      try {
        assertCompleteResponses(events, mockResponse, 1)
        return true
      } catch {
        return false
      }
    }, 20_000)

    const firstCallCount = mockStreamFn.mock.calls.length
    const secondSendRes = await fetch(`${entityApiUrl}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({
        from: `user`,
        payload: `Please answer via pull-wake again after idle.`,
      }),
    })
    expect(secondSendRes.status).toBe(204)

    await waitFor(
      async () => mockStreamFn.mock.calls.length > firstCallCount,
      20_000,
      50
    )

    await waitFor(async () => {
      const events = await readStreamEvents(streamBaseUrl, spawned.streams.main)
      try {
        assertCompleteResponses(events, mockResponse, 2)
        return true
      } catch {
        return false
      }
    }, 20_000)

    const wakeEvents = await readStreamEvents(streamBaseUrl, runner.wake_stream!)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)
    expect(
      wakeEvents.filter((event) => JSON.stringify(event).includes(`runner:${runnerId}`))
        .length
    ).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
