/**
 * Wake Registry unit tests and integration tests.
 *
 * Unit tests: server-side WakeRegistry evaluation of wake conditions
 * after durable writes — runFinished, collection change,
 * debounce coalescing, timeout delivery, cleanup, and manifest rebuild.
 *
 * Integration tests: end-to-end spawn with wake, event append triggering
 * wake delivery, WakeEvent in webhook body — using ElectricAgentsServer + a backing
 * DurableStreamTestServer.
 */

import { createServer } from 'node:http'
import { DurableStreamTestServer } from '@durable-streams/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ElectricAgentsManager } from '../src/electric-agents-manager'
import { ElectricAgentsServer } from '../src/server'
import { WakeRegistry } from '../src/wake-registry'
import { timeStep, waitForStreamEvents } from './test-utils'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'
import type { Server } from 'node:http'
import type { WakeEvalResult } from '../src/wake-registry'

let nextDbId = 1
function createMockDb(): any {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve([{ id: nextDbId++ }]),
        }),
      }),
    }),
    delete: () => ({
      where: () => Promise.resolve(),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    select: () => ({
      from: () => Promise.resolve([]),
    }),
  }
}

describe(`Wake Registry`, () => {
  it(`evaluates runFinished condition on completed run event`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })

    const results = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.subscriberUrl).toBe(`/parent/p1`)
    expect(results[0]!.registrationDbId).toBeTypeOf(`number`)
    expect(results[0]!.sourceEventKey).toBe(`update:run-1`)
    expect(results[0]!.wakeMessage.source).toBe(`/child/c1`)
    expect(results[0]!.wakeMessage.timeout).toBe(false)
    expect(results[0]!.wakeMessage.changes).toHaveLength(1)
    expect(results[0]!.wakeMessage.changes[0]!.collection).toBe(`runs`)
  })

  it(`returns registrationDbId and sourceEventKey for immediate matches`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/_cron/abc`,
      condition: { on: `change` },
      oneShot: false,
    })

    const results = registry.evaluate(`/_cron/abc`, {
      type: `cron_tick`,
      key: `tick-7`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.registrationDbId).toBeTypeOf(`number`)
    expect(results[0]!.sourceEventKey).toBe(`insert:tick-7`)
  })

  it(`keeps distinct registrations distinct for the same source event`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/_cron/abc`,
      condition: { on: `change` },
      oneShot: false,
    })
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/_cron/abc`,
      condition: { on: `change`, collections: [`cron_tick`] },
      oneShot: false,
    })

    const results = registry.evaluate(`/_cron/abc`, {
      type: `cron_tick`,
      key: `tick-7`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(results).toHaveLength(2)
    expect(new Set(results.map((r) => r.registrationDbId)).size).toBe(2)
    expect(new Set(results.map((r) => r.sourceEventKey))).toEqual(
      new Set([`insert:tick-7`])
    )
  })

  it(`runFinished remains active for repeated child completions`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })

    const first = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    expect(first).toHaveLength(1)

    const second = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-2`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    expect(second).toHaveLength(1)
  })

  it(`evaluates collection change condition`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    const results = registry.evaluate(`/source/s1`, {
      type: `texts`,
      key: `text-1`,
      value: { content: `hello` },
      headers: { operation: `insert` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.wakeMessage.changes[0]!.collection).toBe(`texts`)
    expect(results[0]!.wakeMessage.changes[0]!.kind).toBe(`insert`)
  })

  it(`ignores events for non-matching collections`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    const results = registry.evaluate(`/source/s1`, {
      type: `toolCalls`,
      key: `tc-1`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(results).toHaveLength(0)
  })

  it(`filters collection wakes by operation kind when ops is provided`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: {
        on: `change`,
        collections: [`members`],
        ops: [`delete`],
      },
      oneShot: false,
    })

    const insertResults = registry.evaluate(`/source/s1`, {
      type: `members`,
      key: `/task/a`,
      value: { url: `/task/a` },
      headers: { operation: `insert` },
    })
    const deleteResults = registry.evaluate(`/source/s1`, {
      type: `members`,
      key: `/task/a`,
      old_value: { url: `/task/a` },
      headers: { operation: `delete` },
    })

    expect(insertResults).toHaveLength(0)
    expect(deleteResults).toHaveLength(1)
    expect(deleteResults[0]!.wakeMessage.changes[0]).toEqual({
      collection: `members`,
      kind: `delete`,
      key: `/task/a`,
    })
  })

  it(`cleanup on subscriber deletion removes all registrations`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c2`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    await registry.unregisterBySubscriber(`/parent/p1`)

    const r1 = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    const r2 = registry.evaluate(`/child/c2`, {
      type: `texts`,
      key: `t-1`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(r1).toHaveLength(0)
    expect(r2).toHaveLength(0)
  })

  it(`surgical unregister removes only the targeted subscriber+source pair`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c2`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    await registry.unregisterBySubscriberAndSource(`/parent/p1`, `/child/c1`)

    const r1 = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    const r2 = registry.evaluate(`/child/c2`, {
      type: `texts`,
      key: `t-1`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(r1).toHaveLength(0)
    expect(r2).toHaveLength(1)
  })

  it(`register() rejects when DB insert fails so callers can catch`, async () => {
    const failingDb = {
      ...createMockDb(),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () => Promise.reject(new Error(`connection refused`)),
          }),
        }),
      }),
    }
    const registry = new WakeRegistry(failingDb)

    await expect(
      registry.register({
        subscriberUrl: `/parent/p1`,
        sourceUrl: `/child/c1`,
        condition: `runFinished`,
        oneShot: false,
      })
    ).rejects.toThrow(`connection refused`)
  })

  it(`rebuilds registry from register calls`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    const runResults = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    expect(runResults).toHaveLength(1)
    expect(runResults[0]!.subscriberUrl).toBe(`/parent/p1`)

    const changeResults = registry.evaluate(`/source/s1`, {
      type: `texts`,
      key: `t-1`,
      value: {},
      headers: { operation: `insert` },
    })
    expect(changeResults).toHaveLength(1)
    expect(changeResults[0]!.subscriberUrl).toBe(`/parent/p1`)
  })

  it(`evaluates shared-state wakes against the shared-state stream path`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/_electric/shared-state/board-1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    const results = registry.evaluate(`/_electric/shared-state/board-1`, {
      type: `texts`,
      key: `t-1`,
      value: {},
      headers: { operation: `insert` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.subscriberUrl).toBe(`/parent/p1`)
  })

  it(`delivers timeout wake when timeoutMs expires`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const delivered: Array<WakeEvalResult> = []
    registry.setTimeoutCallback((result) => {
      delivered.push(result)
    })

    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
      timeoutMs: 200,
    })

    await new Promise((r) => setTimeout(r, 350))

    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.registrationDbId).toBeTypeOf(`number`)
    expect(delivered[0]!.sourceEventKey).toBe(`timeout`)
    expect(delivered[0]!.wakeMessage.timeout).toBe(true)
    expect(delivered[0]!.wakeMessage.source).toBe(`/child/c1`)
    expect(delivered[0]!.wakeMessage.changes).toHaveLength(0)
  })

  it(`debounce coalesces rapid events into single wake`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const debounced: Array<WakeEvalResult> = []
    registry.setDebounceCallback((result) => {
      debounced.push(result)
    })

    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
      debounceMs: 300,
    })

    for (let i = 0; i < 3; i++) {
      const immediate = registry.evaluate(`/source/s1`, {
        type: `texts`,
        key: `text-${i}`,
        value: { content: `msg-${i}` },
        headers: { operation: `insert` },
      })
      expect(immediate).toHaveLength(0)
    }

    await new Promise((r) => setTimeout(r, 500))

    expect(debounced).toHaveLength(1)
    expect(debounced[0]!.registrationDbId).toBeTypeOf(`number`)
    expect(debounced[0]!.sourceEventKey).toBe(`text-2`)
    expect(debounced[0]!.wakeMessage.changes).toHaveLength(3)
    expect(debounced[0]!.wakeMessage.source).toBe(`/source/s1`)
  })

  it(`keeps debounced registrations distinct for different conditions on the same source`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const debounced: Array<WakeEvalResult> = []
    registry.setDebounceCallback((result) => {
      debounced.push(result)
    })

    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
      debounceMs: 100,
    })
    await registry.register({
      subscriberUrl: `/watcher/w1`,
      sourceUrl: `/source/s1`,
      condition: { on: `change`, collections: [`toolCalls`] },
      oneShot: false,
      debounceMs: 100,
    })

    expect(
      registry.evaluate(`/source/s1`, {
        type: `texts`,
        key: `text-1`,
        value: { content: `hello` },
        headers: { operation: `insert` },
      })
    ).toHaveLength(0)

    expect(
      registry.evaluate(`/source/s1`, {
        type: `toolCalls`,
        key: `tool-1`,
        value: { name: `search` },
        headers: { operation: `insert` },
      })
    ).toHaveLength(0)

    await new Promise((r) => setTimeout(r, 250))

    expect(debounced).toHaveLength(2)
    expect(
      debounced
        .map((result) => result.wakeMessage.changes[0]!.collection)
        .sort()
    ).toEqual([`texts`, `toolCalls`])
    expect(
      debounced.every((result) => result.wakeMessage.changes.length === 1)
    ).toBe(true)
    expect(
      new Set(debounced.map((result) => result.registrationDbId)).size
    ).toBe(2)
  })

  it(`deliverWakeResult keys fanout by registrationDbId and sourceEventKey`, async () => {
    const appendIdempotent = vi.fn().mockResolvedValue(undefined)
    const manager = {
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/watcher/w1`,
          streams: { main: `/watcher/w1/main` },
        }),
      },
      streamClient: { appendIdempotent },
      encodeChangeEvent: (event: Record<string, unknown>) =>
        new TextEncoder().encode(JSON.stringify(event)),
      buildWakeMessage: vi.fn(async (_subscriber, result) => ({
        timestamp: new Date(0).toISOString(),
        source: result.wakeMessage.source,
        timeout: result.wakeMessage.timeout,
        changes: result.wakeMessage.changes,
      })),
    } as any

    await (ElectricAgentsManager.prototype as any).deliverWakeResult.call(
      manager,
      {
        subscriberUrl: `/watcher/w1`,
        registrationDbId: 41,
        sourceEventKey: `tick-7`,
        wakeMessage: {
          source: `/_cron/abc`,
          timeout: false,
          changes: [{ collection: `cron_tick`, kind: `insert`, key: `tick-7` }],
        },
      }
    )

    const event = JSON.parse(
      new TextDecoder().decode(appendIdempotent.mock.calls[0]![1] as Uint8Array)
    ) as Record<string, unknown>

    expect(event.key).toBe(`wake-41-tick-7`)
    expect(appendIdempotent.mock.calls[0]![2]).toEqual({
      producerId: `wake-reg-41-tick-7`,
    })
  })

  it(`passes includeResponse through evaluate result`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
      includeResponse: false,
    })

    const results = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.includeResponse).toBe(false)
  })

  it(`includeResponse defaults to undefined when not set`, async () => {
    const registry = new WakeRegistry(createMockDb())
    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })

    const results = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.includeResponse).toBeUndefined()
  })

  it(`debounced runFinished preserves runFinishedStatus and includeResponse`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const delivered: Array<WakeEvalResult> = []
    registry.setDebounceCallback((result) => {
      delivered.push(result)
    })

    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
      debounceMs: 50,
      includeResponse: true,
    })

    // Immediate evaluate should return nothing (debounced)
    const results = registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })
    expect(results).toHaveLength(0)

    // Wait for debounce to fire
    await new Promise((r) => setTimeout(r, 150))

    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.runFinishedStatus).toBe(`completed`)
    expect(delivered[0]!.includeResponse).toBe(true)
    expect(delivered[0]!.wakeMessage.changes).toHaveLength(1)
    expect(delivered[0]!.wakeMessage.changes[0]!.collection).toBe(`runs`)
  })

  it(`debounced multi-run: status matches changes[0] run key`, async () => {
    const registry = new WakeRegistry(createMockDb())
    const delivered: Array<WakeEvalResult> = []
    registry.setDebounceCallback((result) => {
      delivered.push(result)
    })

    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
      debounceMs: 50,
    })

    // run-1 completes
    registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    // run-2 fails in the same debounce window
    registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-2`,
      value: { status: `failed` },
      headers: { operation: `update` },
    })

    await new Promise((r) => setTimeout(r, 150))

    expect(delivered).toHaveLength(1)
    const result = delivered[0]!
    expect(result.wakeMessage.changes[0]!.key).toBe(`run-1`)
    expect(result.wakeMessage.changes[1]!.key).toBe(`run-2`)
    // runFinishedStatus is the latest (run-2 = "failed"), and buildWakeMessage
    // uses the LAST change's key for response extraction — so status and
    // response key are consistent (both from run-2)
    expect(result.runFinishedStatus).toBe(`failed`)
    const lastChange =
      result.wakeMessage.changes[result.wakeMessage.changes.length - 1]!
    expect(lastChange.key).toBe(`run-2`)
  })
})

// ============================================================================
// Wake Registry Integration Tests
// ============================================================================

describe(`Wake Registry Integration`, () => {
  let dsServer: DurableStreamTestServer
  let electricAgentsServer: ElectricAgentsServer
  let baseUrl: string
  let receiver: Server
  let receiverUrl: string
  let wakeCount = 0
  let wakeResolvers: Array<() => void> = []

  function getElectricAgentsManager(): ElectricAgentsManager {
    return (electricAgentsServer as any)
      .electricAgentsManager as ElectricAgentsManager
  }

  beforeAll(async () => {
    await timeStep(`wake-registry beforeAll`, async () => {
      receiver = createServer((req, res) => {
        const chunks: Array<Buffer> = []
        req.on(`data`, (c: Buffer) => chunks.push(c))
        req.on(`end`, () => {
          wakeCount++
          res.writeHead(200, { 'content-type': `application/json` })
          res.end(JSON.stringify({ done: true }))
          const resolvers = wakeResolvers
          wakeResolvers = []
          for (const resolve of resolvers) resolve()
        })
      })

      dsServer = new DurableStreamTestServer({
        port: 0,
        webhooks: true,
      })
      const receiverReady = new Promise<void>((resolve) =>
        receiver.listen(0, `127.0.0.1`, () => resolve())
      )
      await Promise.all([
        resetElectricAgentsTestBackend(),
        timeStep(`DurableStreamTestServer.start`, async () => {
          await dsServer.start()
        }),
        receiverReady,
      ])
      const addr = receiver.address() as { port: number }
      receiverUrl = `http://127.0.0.1:${addr.port}`

      electricAgentsServer = new ElectricAgentsServer({
        durableStreamsUrl: dsServer.url,
        port: 0,
        postgresUrl: TEST_POSTGRES_URL,
        electricUrl: TEST_ELECTRIC_URL,
      })
      baseUrl = await timeStep(`ElectricAgentsServer.start`, async () => {
        return await electricAgentsServer.start()
      })
    })
  }, 120_000)

  afterAll(async () => {
    await timeStep(`wake-registry afterAll`, async () => {
      receiver.closeAllConnections()
      await Promise.allSettled([
        electricAgentsServer?.stop(),
        dsServer?.stop(),
        new Promise<void>((resolve) => receiver.close(() => resolve())),
      ])
    })
  }, 120_000)

  function waitForWakes(
    targetCount: number,
    timeoutMs = 10_000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (wakeCount >= targetCount) {
        resolve()
        return
      }
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              `Timed out waiting for ${targetCount} wakes (got ${wakeCount})`
            )
          ),
        timeoutMs
      )
      const check = (): void => {
        if (wakeCount >= targetCount) {
          clearTimeout(timeout)
          resolve()
        } else {
          wakeResolvers.push(check)
        }
      }
      wakeResolvers.push(check)
    })
  }

  async function waitForWakeEvents(
    streamPath: string,
    count: number,
    timeoutMs = 5_000
  ): Promise<Array<Record<string, unknown>>> {
    const events = await waitForStreamEvents(
      baseUrl,
      streamPath,
      (currentEvents) =>
        currentEvents.filter((event) => event.type === `wake`).length >= count,
      timeoutMs
    )
    return events.filter((event) => event.type === `wake`)
  }

  async function appendInternalEvent(
    streamPath: string,
    event: Record<string, unknown>
  ): Promise<void> {
    await electricAgentsServer.streamClient.append(
      streamPath,
      JSON.stringify(event)
    )
  }

  it(`spawn with wake registers condition and delivers wake on child run completion`, async () => {
    const startCount = wakeCount
    const ts = Date.now()
    const typeName = `wakerf${ts}`

    // Register entity type
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `wake runFinished test`,
      }),
    })
    expect(typeRes.status).toBe(201)

    // Create subscription pointing to our webhook receiver
    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-sub-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    // Spawn parent entity
    const parentRes = await fetch(`${baseUrl}/${typeName}/parent`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(parentRes.status).toBe(201)
    const parent = (await parentRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Send a message to trigger the initial webhook wake for parent
    await fetch(`${baseUrl}${parent.url}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ from: `test`, payload: `init` }),
    })

    // Wait for the parent's webhook
    await waitForWakes(startCount + 1)

    // Spawn child entity
    const childRes = await fetch(`${baseUrl}/${typeName}/child`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ parent: parent.url }),
    })
    expect(childRes.status).toBe(201)
    const child = (await childRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Register runFinished wake condition: parent subscribes to child
    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: parent.url,
      sourceUrl: child.url,
      condition: `runFinished`,
      oneShot: false,
    })

    // Trigger wake evaluation directly to test the full server-side delivery chain
    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: `run-direct`,
      value: { status: `completed`, result: `done` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(parent.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)
    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    expect(wakeValue.source).toBe(child.url)
    expect(wakeValue.timeout).toBe(false)

    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: `run-direct-2`,
      value: { status: `completed`, result: `done-again` },
      headers: { operation: `update` },
    })

    const secondWakeEvents = await waitForWakeEvents(parent.streams.main, 2)
    expect(secondWakeEvents).toHaveLength(2)
  }, 15_000)

  it(`runFinished wake includes child text response by default`, async () => {
    const ts = Date.now()
    const typeName = `wakeresp${ts}`

    // Register entity type
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `wake response test`,
      }),
    })
    expect(typeRes.status).toBe(201)

    // Create subscription (matches existing test pattern)
    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-resp-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    // Spawn parent
    const parentRes = await fetch(`${baseUrl}/${typeName}/parent`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
    })
    expect(parentRes.status).toBe(201)
    const parent = (await parentRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Spawn child with parent
    const childRes = await fetch(`${baseUrl}/${typeName}/child`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ parent: parent.url }),
    })
    expect(childRes.status).toBe(201)
    const child = (await childRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Write text deltas to the child's stream simulating an LLM response
    const runId = `run-1`
    const textId = `text-1`

    // Write run started
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: runId,
      value: { status: `started` },
      headers: { operation: `insert` },
    })

    // Write text deltas
    for (const delta of [`Hello `, `from `, `child!`]) {
      await appendInternalEvent(child.streams.main, {
        type: `text_delta`,
        key: `${textId}:${Math.random().toString(36).slice(2, 6)}`,
        value: { text_id: textId, run_id: runId, delta },
        headers: { operation: `insert` },
      })
    }

    // Write run completed to child stream
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: runId,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    // Register runFinished wake condition: parent subscribes to child
    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: parent.url,
      sourceUrl: child.url,
      condition: `runFinished`,
      oneShot: false,
    })

    // Trigger wake evaluation with the same run event
    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: runId,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(parent.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)

    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    const finishedChild = wakeValue.finished_child as Record<string, unknown>
    expect(finishedChild).toBeDefined()
    expect(finishedChild.run_status).toBe(`completed`)
    expect(finishedChild.response).toBe(`Hello from child!`)
    expect(finishedChild.error).toBeUndefined()
  }, 15_000)

  it(`runFinished wake omits response when includeResponse is false`, async () => {
    const ts = Date.now()
    const typeName = `wakenoresp${ts}`

    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `wake no-response test`,
      }),
    })
    expect(typeRes.status).toBe(201)

    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-noresp-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    const parentRes = await fetch(`${baseUrl}/${typeName}/parent`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
    })
    expect(parentRes.status).toBe(201)
    const parent = (await parentRes.json()) as {
      url: string
      streams: { main: string }
    }

    const childRes = await fetch(`${baseUrl}/${typeName}/child`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ parent: parent.url }),
    })
    expect(childRes.status).toBe(201)
    const child = (await childRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Write text deltas to child's stream
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `started` },
      headers: { operation: `insert` },
    })
    await appendInternalEvent(child.streams.main, {
      type: `text_delta`,
      key: `td-1`,
      value: { text_id: `t1`, run_id: `run-1`, delta: `Some text` },
      headers: { operation: `insert` },
    })
    // Write run completed to child stream
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    // Register with includeResponse: false
    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: parent.url,
      sourceUrl: child.url,
      condition: `runFinished`,
      oneShot: false,
      includeResponse: false,
    })

    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(parent.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)

    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    const finishedChild = wakeValue.finished_child as Record<string, unknown>
    expect(finishedChild).toBeDefined()
    expect(finishedChild.run_status).toBe(`completed`)
    expect(finishedChild.response).toBeUndefined()
  }, 15_000)

  it(`runFinished wake includes error for failed runs`, async () => {
    const ts = Date.now()
    const typeName = `wakeerr${ts}`

    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `wake error test`,
      }),
    })
    expect(typeRes.status).toBe(201)

    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-err-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    const parentRes = await fetch(`${baseUrl}/${typeName}/parent`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
    })
    expect(parentRes.status).toBe(201)
    const parent = (await parentRes.json()) as {
      url: string
      streams: { main: string }
    }

    const childRes = await fetch(`${baseUrl}/${typeName}/child`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ parent: parent.url }),
    })
    expect(childRes.status).toBe(201)
    const child = (await childRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Write run started
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `started` },
      headers: { operation: `insert` },
    })

    // Write some text before failure
    await appendInternalEvent(child.streams.main, {
      type: `text_delta`,
      key: `td-1`,
      value: { text_id: `t1`, run_id: `run-1`, delta: `Partial output` },
      headers: { operation: `insert` },
    })

    // Write error event
    await appendInternalEvent(child.streams.main, {
      type: `error`,
      key: `err-1`,
      value: {
        error_code: `RATE_LIMIT`,
        message: `Rate limit exceeded`,
        run_id: `run-1`,
      },
      headers: { operation: `insert` },
    })

    // Write run failed to child stream
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `failed` },
      headers: { operation: `update` },
    })

    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: parent.url,
      sourceUrl: child.url,
      condition: `runFinished`,
      oneShot: false,
    })

    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: `run-1`,
      value: { status: `failed` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(parent.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)

    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    const finishedChild = wakeValue.finished_child as Record<string, unknown>
    expect(finishedChild).toBeDefined()
    expect(finishedChild.run_status).toBe(`failed`)
    expect(finishedChild.response).toBe(`Partial output`)
    expect(finishedChild.error).toBe(`Rate limit exceeded`)
  }, 15_000)

  it(`error extraction ignores unscoped errors from other wake cycles`, async () => {
    const ts = Date.now()
    const typeName = `wakeunscoped${ts}`

    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `wake unscoped error test`,
      }),
    })
    expect(typeRes.status).toBe(201)

    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-unscoped-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    const parentRes = await fetch(`${baseUrl}/${typeName}/parent`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
    })
    expect(parentRes.status).toBe(201)
    const parent = (await parentRes.json()) as {
      url: string
      streams: { main: string }
    }

    const childRes = await fetch(`${baseUrl}/${typeName}/child`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ parent: parent.url }),
    })
    expect(childRes.status).toBe(201)
    const child = (await childRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Write an OLD unscoped error (no run_id) — simulating HANDLER_FAILED from a previous cycle
    await appendInternalEvent(child.streams.main, {
      type: `error`,
      key: `old-err-1`,
      value: {
        error_code: `HANDLER_FAILED`,
        message: `Old handler failure from previous cycle`,
      },
      headers: { operation: `insert` },
    })

    // Now a new run starts, produces text, has a scoped error, and fails
    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `started` },
      headers: { operation: `insert` },
    })

    await appendInternalEvent(child.streams.main, {
      type: `error`,
      key: `err-scoped`,
      value: {
        error_code: `API_ERROR`,
        message: `Actual run error`,
        run_id: `run-1`,
      },
      headers: { operation: `insert` },
    })

    await appendInternalEvent(child.streams.main, {
      type: `run`,
      key: `run-1`,
      value: { status: `failed` },
      headers: { operation: `update` },
    })

    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: parent.url,
      sourceUrl: child.url,
      condition: `runFinished`,
      oneShot: false,
    })

    await manager.evaluateWakes(child.url, {
      type: `run`,
      key: `run-1`,
      value: { status: `failed` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(parent.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)

    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    const finishedChild = wakeValue.finished_child as Record<string, unknown>
    expect(finishedChild).toBeDefined()
    expect(finishedChild.run_status).toBe(`failed`)
    // Should only include the scoped error, NOT the old unscoped one
    expect(finishedChild.error).toBe(`Actual run error`)
  }, 15_000)

  it(`event append triggers wake delivery for change condition`, async () => {
    const ts = Date.now()
    const typeName = `wakechg${ts}`

    // Register entity type
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ name: typeName, description: `wake change test` }),
    })
    expect(typeRes.status).toBe(201)

    // Create subscription
    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-chg-sub-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    // Spawn watcher entity
    const watcherRes = await fetch(`${baseUrl}/${typeName}/watcher`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(watcherRes.status).toBe(201)
    const watcher = (await watcherRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Spawn source entity
    const sourceRes = await fetch(`${baseUrl}/${typeName}/source`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(sourceRes.status).toBe(201)
    const source = (await sourceRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Register change wake condition: watcher observes source texts collection
    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: watcher.url,
      sourceUrl: source.url,
      condition: { on: `change`, collections: [`texts`] },
      oneShot: false,
    })

    // Send a message to watcher to trigger initial webhook (transition consumer to idle)
    await fetch(`${baseUrl}${watcher.url}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ from: `test`, payload: `init` }),
    })
    const afterSendTarget = wakeCount + 1
    await waitForWakes(afterSendTarget)

    // Trigger wake evaluation directly on the manager
    await manager.evaluateWakes(source.url, {
      type: `texts`,
      key: `text-1`,
      value: { content: `hello world` },
      headers: { operation: `insert` },
    })

    const wakeEvents = await waitForWakeEvents(watcher.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)
    const wakeValue = wakeEvents[0]!.value as Record<string, unknown>
    expect(wakeValue.source).toBe(source.url)
  }, 15_000)

  it(`WakeEvent in subscriber stream includes source and change details`, async () => {
    const ts = Date.now()
    const typeName = `wakebody${ts}`

    // Register entity type
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ name: typeName, description: `wake body test` }),
    })
    expect(typeRes.status).toBe(201)

    // Create subscription
    const subRes = await fetch(
      `${baseUrl}/${typeName}/**?subscription=wake-body-sub-${ts}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ webhook: receiverUrl }),
      }
    )
    expect(subRes.status).toBeLessThan(300)

    // Spawn subscriber entity
    const subscriberRes = await fetch(`${baseUrl}/${typeName}/subscriber`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(subscriberRes.status).toBe(201)
    const subscriber = (await subscriberRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Spawn observed entity
    const observedRes = await fetch(`${baseUrl}/${typeName}/observed`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(observedRes.status).toBe(201)
    const observed = (await observedRes.json()) as {
      url: string
      streams: { main: string }
    }

    // Register runFinished wake condition
    const manager = getElectricAgentsManager()
    await manager.wakeRegistry.register({
      subscriberUrl: subscriber.url,
      sourceUrl: observed.url,
      condition: `runFinished`,
      oneShot: false,
    })

    // Trigger initial webhook for subscriber
    await fetch(`${baseUrl}${subscriber.url}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ from: `test`, payload: `init` }),
    })
    const afterSendTarget = wakeCount + 1
    await waitForWakes(afterSendTarget)

    // Trigger wake evaluation directly
    await manager.evaluateWakes(observed.url, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed`, result: `finished` },
      headers: { operation: `update` },
    })

    const wakeEvents = await waitForWakeEvents(subscriber.streams.main, 1)
    expect(wakeEvents.length).toBeGreaterThanOrEqual(1)
    const wakeEvent = wakeEvents[0]!
    const wakeValue = wakeEvent.value as Record<string, unknown>
    expect(typeof wakeValue.timestamp).toBe(`string`)
    expect(wakeValue.source).toBe(observed.url)
    expect(wakeValue.timeout).toBe(false)
    expect(wakeValue.changes).toBeDefined()
    const changes = wakeValue.changes as Array<Record<string, unknown>>
    expect(changes.length).toBeGreaterThanOrEqual(1)
    expect(changes[0]!.collection).toBe(`runs`)
  }, 15_000)
})
