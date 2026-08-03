import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { BuiltinAgentsServer } from '../../agents/src/server'
import { ElectricAgentsServer } from '../src/server'
import { parsePrincipalKey } from '../src/principal'
import {
  durableStreamTestServerUrl,
  readStreamEvents,
  waitFor,
} from './test-utils'
import {
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'
import type { StreamFn } from '@earendil-works/pi-agent-core'

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

function runnerEntitySubscriptionId(
  runnerId: string,
  entityUrl: string
): string {
  const digest = createHash(`sha256`).update(entityUrl).digest(`hex`)
  return `runner:${runnerId}:${digest.slice(0, 16)}`
}

function subscriptionUrl(
  streamBaseUrl: string,
  subscriptionId: string
): string {
  const url = new URL(streamBaseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, ``)}/__ds/subscriptions/${encodeURIComponent(subscriptionId)}`
  return url.toString()
}

function truncateDiagnostic(value: string, max = 4_000): string {
  return value.length > max ? `${value.slice(0, max)}...<truncated>` : value
}

async function responseDiagnostic(
  label: string,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<string> {
  try {
    const res = await fetch(input, init)
    const body = truncateDiagnostic(await res.text())
    return `${label}: ${res.status} ${res.statusText}\n${body}`
  } catch (err) {
    return `${label}: fetch failed\n${err instanceof Error ? err.stack : String(err)}`
  }
}

async function expectSuccessfulWriteWithDiagnostics(
  res: Response,
  opts: {
    phase: string
    baseUrl: string
    streamBaseUrl: string
    entityApiUrl: string
    entityUrl: string
    runnerId: string
    authHeaders: Record<string, string>
  }
): Promise<void> {
  if (res.status === 204) return
  if (res.ok) {
    const rawBody = (await res.text()).trim()
    if (!rawBody) return
    const parsed = JSON.parse(rawBody) as { txid?: unknown }
    expect(parsed.txid).toEqual(expect.any(String))
    return
  }

  const body = truncateDiagnostic(await res.text())
  const subscriptionId = runnerEntitySubscriptionId(
    opts.runnerId,
    opts.entityUrl
  )
  const diagnostics = await Promise.all([
    responseDiagnostic(`entity`, opts.entityApiUrl, {
      headers: opts.authHeaders,
    }),
    responseDiagnostic(
      `runner`,
      `${opts.baseUrl}/_electric/runners/${opts.runnerId}`,
      {
        headers: opts.authHeaders,
      }
    ),
    responseDiagnostic(
      `runner health`,
      `${opts.baseUrl}/_electric/runners/${opts.runnerId}/health`,
      { headers: opts.authHeaders }
    ),
    responseDiagnostic(
      `subscription ${subscriptionId}`,
      subscriptionUrl(opts.streamBaseUrl, subscriptionId)
    ),
  ])

  throw new Error(
    [
      `${opts.phase} returned ${res.status} ${res.statusText}; expected successful write response`,
      `response body:\n${body}`,
      ...diagnostics,
    ].join(`\n\n`)
  )
}

async function waitForMockCallWithDiagnostics(
  predicate: () => boolean,
  opts: {
    phase: string
    baseUrl: string
    streamBaseUrl: string
    entityApiUrl: string
    entityUrl: string
    entityStream: string
    runnerId: string
    authHeaders: Record<string, string>
  }
): Promise<void> {
  try {
    await waitFor(async () => predicate(), 20_000, 50)
  } catch (err) {
    const subscriptionId = runnerEntitySubscriptionId(
      opts.runnerId,
      opts.entityUrl
    )
    const diagnostics = await Promise.all([
      responseDiagnostic(`entity`, opts.entityApiUrl, {
        headers: opts.authHeaders,
      }),
      responseDiagnostic(
        `runner health`,
        `${opts.baseUrl}/_electric/runners/${opts.runnerId}/health`,
        { headers: opts.authHeaders }
      ),
      responseDiagnostic(
        `subscription ${subscriptionId}`,
        subscriptionUrl(opts.streamBaseUrl, subscriptionId)
      ),
      responseDiagnostic(
        `runner wake stream`,
        `${opts.streamBaseUrl}/runners/${opts.runnerId}/wake?offset=-1&live=false`
      ),
      responseDiagnostic(
        `entity main stream`,
        `${opts.streamBaseUrl}${opts.entityStream}?offset=-1&live=false`
      ),
    ])

    throw new Error(
      [
        `${opts.phase} did not reach Horton within 20000ms`,
        err instanceof Error ? err.message : String(err),
        ...diagnostics,
      ].join(`\n\n`)
    )
  }
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
  const testPrincipal = parsePrincipalKey(`user:test-user`)
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
      durableStreamsUrl: durableStreamTestServerUrl(dsServer.url),
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: undefined,
      authenticateRequest: (req) =>
        req.headers.get(`authorization`) === authHeaders.authorization
          ? testPrincipal
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
        ownerPrincipal: testPrincipal.url,
        headers: authHeaders,
        claimHeaders: authHeaders,
        claimTokenHeader: `electric-claim-token`,
      },
    })
    await builtinAgentsServer.start()
  }, 60_000)

  afterAll(async () => {
    await builtinAgentsServer?.stop().catch(() => {})
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
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
        from: testPrincipal.url,
        payload: `Please answer via pull-wake.`,
      }),
    })
    await expectSuccessfulWriteWithDiagnostics(sendRes, {
      phase: `initial send`,
      baseUrl,
      streamBaseUrl,
      entityApiUrl,
      entityUrl,
      runnerId,
      authHeaders,
    })

    await waitForMockCallWithDiagnostics(
      () => mockStreamFn.mock.calls.length > 0,
      {
        phase: `initial send`,
        baseUrl,
        streamBaseUrl,
        entityApiUrl,
        entityUrl,
        entityStream: spawned.streams.main,
        runnerId,
        authHeaders,
      }
    )

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
        from: testPrincipal.url,
        payload: `Please answer via pull-wake again after idle.`,
      }),
    })
    await expectSuccessfulWriteWithDiagnostics(secondSendRes, {
      phase: `second send`,
      baseUrl,
      streamBaseUrl,
      entityApiUrl,
      entityUrl,
      runnerId,
      authHeaders,
    })

    await waitForMockCallWithDiagnostics(
      () => mockStreamFn.mock.calls.length > firstCallCount,
      {
        phase: `second send`,
        baseUrl,
        streamBaseUrl,
        entityApiUrl,
        entityUrl,
        entityStream: spawned.streams.main,
        runnerId,
        authHeaders,
      }
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

    const wakeEvents = await readStreamEvents(
      streamBaseUrl,
      runner.wake_stream!
    )
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)
    expect(
      wakeEvents.filter((event) =>
        JSON.stringify(event).includes(`runner:${runnerId}`)
      ).length
    ).toBeGreaterThanOrEqual(1)
  }, 60_000)
})
