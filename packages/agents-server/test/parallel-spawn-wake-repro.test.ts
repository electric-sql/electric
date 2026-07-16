/**
 * Reproduction: parent spawns N sub-agents in one turn (parallel), and must be
 * woken once per child when each child's run finishes.
 *
 * Mirrors the domo app: a single pull-wake runner hosts a `parent` agent (our
 * custom deterministic handler) plus the built-in `worker`. The parent, on its
 * first inbox wake, spawns N workers concurrently with a `runFinished` wake on
 * each, then ends its turn. Each worker runs (mock LLM) and finishes; the server
 * should deliver a wake to the parent for EVERY child.
 *
 * Bug (AGENTS.md gotcha 4): only one child's runFinished wakes the parent; the
 * others are silently dropped. This test asserts the parent observes ALL N.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'
import { createBuiltinAgentHandler } from '../../agents/src/bootstrap'
import { createPullWakeRunner } from '@electric-ax/agents-runtime'
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
import type { HandlerContext, WakeEvent } from '@electric-ax/agents-runtime'
import type { StreamFn } from '@mariozechner/pi-agent-core'

const CHILD_COUNT = 6

// Per-parent record of which child sources have woken it.
const parentWakes = new Map<string, Set<string>>()
// Per-parent record of the full wake invocation log (for diagnostics).
const parentWakeLog = new Map<string, Array<{ type: string; source: string }>>()
const parentSpawned = new Set<string>()
const spawnedChildren = new Map<string, Array<string>>()

function record(
  map: Map<string, Set<string>>,
  parent: string,
  child: string
): void {
  const set = map.get(parent) ?? new Set<string>()
  set.add(child)
  map.set(parent, set)
}

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

describe(`parallel sub-agent spawn wake delivery`, () => {
  let dsServer: DurableStreamTestServer
  let electricAgentsServer: ElectricAgentsServer
  let bootstrap: NonNullable<
    Awaited<ReturnType<typeof createBuiltinAgentHandler>>
  >
  let puller: ReturnType<typeof createPullWakeRunner>
  let baseUrl = ``
  let streamBaseUrl = ``
  const runnerId = `parallel-spawn-repro-runner`
  const authHeaders = { authorization: `Bearer test-token` }
  const testPrincipal = parsePrincipalKey(`user:test-user`)
  const mockStreamFn = createMockStreamFn(`mock child response`)

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

    const created = await createBuiltinAgentHandler({
      agentServerUrl: baseUrl,
      workingDirectory: process.cwd(),
      streamFn: mockStreamFn,
      serverHeaders: authHeaders,
      defaultDispatchPolicyForType: () => ({
        targets: [{ type: `runner`, runnerId }],
      }),
    })
    if (!created) throw new Error(`bootstrap failed (no model catalog)`)
    bootstrap = created

    // Custom deterministic parent: on first inbox wake, spawn CHILD_COUNT workers
    // in parallel each with a runFinished wake back to us; on later wakes, record
    // which child fired. No LLM run in the parent — keeps spawn timing exact.
    bootstrap.registry.define(`parent`, {
      description: `Repro parent that spawns ${CHILD_COUNT} workers in parallel`,
      permissionGrants: [
        {
          subject_kind: `principal_kind`,
          subject_value: `user`,
          permission: `spawn`,
        },
        {
          subject_kind: `principal_kind`,
          subject_value: `user`,
          permission: `manage`,
        },
      ],
      async handler(ctx: HandlerContext, wake: WakeEvent) {
        const self = ctx.entityUrl
        const log = parentWakeLog.get(self) ?? []
        log.push({ type: wake.type, source: wake.source })
        parentWakeLog.set(self, log)

        const isChildWake =
          wake.source !== self && wake.source.startsWith(`/worker/`)
        if (isChildWake) {
          record(parentWakes, self, wake.source)
          return
        }

        if (parentSpawned.has(self)) return
        parentSpawned.add(self)

        const ids = Array.from(
          { length: CHILD_COUNT },
          (_, i) => `child-${i}-${Math.random().toString(36).slice(2, 8)}`
        )
        spawnedChildren.set(
          self,
          ids.map((id) => `/worker/${id}`)
        )
        await Promise.all(
          ids.map((id) =>
            ctx.spawn(
              `worker`,
              id,
              {
                systemPrompt: `You are a worker. Reply "done".`,
                tools: [`send`],
              },
              {
                initialMessage: `Do your task and finish.`,
                wake: { on: `runFinished`, includeResponse: true },
              }
            )
          )
        )
      },
    })

    await bootstrap.runtime.registerTypes()

    // Register the runner row (advertise sandbox profiles), then start the puller.
    const regRes = await fetch(`${baseUrl}/_electric/runners`, {
      method: `POST`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({
        id: runnerId,
        owner_principal: testPrincipal.url,
        label: `Parallel spawn repro`,
        kind: `local`,
        admin_status: `enabled`,
        sandbox_profiles: bootstrap.runtime.sandboxProfileDescriptors,
      }),
    })
    if (!regRes.ok)
      throw new Error(
        `runner registration failed: ${regRes.status} ${await regRes.text()}`
      )
    const registration = (await regRes.json()) as {
      wake_stream_offset?: string
    }

    puller = createPullWakeRunner({
      baseUrl,
      runnerId,
      runtime: bootstrap.runtime,
      headers: authHeaders,
      claimHeaders: authHeaders,
      claimTokenHeader: `electric-claim-token`,
      offset: registration.wake_stream_offset,
      onError: (error) =>
        console.error(`[repro] pull-wake runner error:`, error),
    })
    puller.start()
  }, 120_000)

  afterAll(async () => {
    await puller?.stop().catch(() => {})
    bootstrap?.runtime.abortWakes()
    await bootstrap?.runtime.drainWakes().catch(() => {})
    await bootstrap?.shutdownSandboxes?.().catch(() => {})
    await Promise.allSettled([electricAgentsServer?.stop(), dsServer?.stop()])
  }, 120_000)

  it(`wakes the parent once per parallel child (${CHILD_COUNT} children)`, async () => {
    const id = `p-${Date.now()}`
    const parentUrl = `/parent/${id}`
    const entityApiUrl = `${baseUrl}/_electric/entities/parent/${id}`

    const spawnRes = await fetch(entityApiUrl, {
      method: `PUT`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({}),
    })
    expect(spawnRes.status).toBe(201)

    const sendRes = await fetch(`${entityApiUrl}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json`, ...authHeaders },
      body: JSON.stringify({
        from: testPrincipal.url,
        payload: `Kick off the workers.`,
      }),
    })
    expect(sendRes.status).toBeLessThan(300)

    // Wait for the parent to have spawned its children.
    await waitFor(
      async () => (spawnedChildren.get(parentUrl)?.length ?? 0) === CHILD_COUNT,
      20_000,
      100
    )

    const children = spawnedChildren.get(parentUrl) ?? []

    // The wake-delivery GUARANTEE we assert is at the production layer: every
    // child's runFinished must append a distinct `wake` event to the parent's
    // stream (source = child url). Bug #1 (the registration-churn gap) drops
    // some of these events entirely. We deliberately do NOT assert on how many
    // times the parent HANDLER ran: the pull-wake runner legitimately coalesces
    // several wake events into one handler invocation (a range wake), and a
    // real parent reads its child-status state rather than the single triggering
    // source — so handler-level coalescing loses no information and is expected.
    const wakeSources = async (): Promise<Set<string>> => {
      const events = await readStreamEvents(
        streamBaseUrl,
        `${parentUrl}/main`
      ).catch(() => [])
      const sources = new Set<string>()
      for (const e of events) {
        const isWake =
          (e as any).type === `wake` || (e as any).value?.type === `wake`
        if (!isWake) continue
        const src = ((e as any).value?.value ?? (e as any).value)?.source
        if (typeof src === `string`) sources.add(src)
      }
      return sources
    }

    let timedOut = false
    try {
      await waitFor(
        async () => {
          const s = await wakeSources()
          return children.every((c) => s.has(c))
        },
        30_000,
        200
      )
    } catch {
      timedOut = true
    }

    const delivered = await wakeSources()
    const missing = children.filter((c) => !delivered.has(c))

    if (missing.length > 0) {
      console.error(
        `\n[repro] MISSING WAKES for ${missing.length}/${CHILD_COUNT} children (no wake event on parent stream):`,
        missing
      )
      console.error(
        `[repro] parent handler wake log (coalescing is OK):`,
        parentWakeLog.get(parentUrl)
      )
      for (const child of children) {
        const events = await readStreamEvents(
          streamBaseUrl,
          `${child}/main`
        ).catch(() => [])
        const runs = events.filter(
          (e) => (e as any).type === `run` || (e as any).value?.type === `run`
        )
        console.error(
          `[repro] child ${child}: ${events.length} events, ${runs.length} run events, delivered=${delivered.has(child)}`
        )
      }
    }

    expect({ timedOut, missing }).toEqual({ timedOut: false, missing: [] })
  }, 90_000)
})
