/**
 * Conformance tests for the Electric Agents entity runtime.
 *
 * Uses the electricAgents() DSL for declarative scenario-based testing.
 * Each test first registers an entity type before spawning entities.
 *
 * Spec reference: docs/electric-agents-spec.md
 */

import { describe, expect, test } from 'vitest'
import * as fc from 'fast-check'
import {
  ServeEndpointReceiver,
  applyElectricAgentsAction,
  checkInvariants,
  checkStateProtocolInvariants,
  electricAgents,
  enabledElectricAgentsActions,
  fetchShapeRows,
} from './electric-agents-dsl'
import { cliTest } from './cli-dsl'
import type {
  ElectricAgentsAction,
  ElectricAgentsWorldModel,
  RunContext,
} from './electric-agents-dsl'

export interface ElectricAgentsTestOptions {
  baseUrl: string
}

// ============================================================================
// Helpers for property-based tests
// ============================================================================

async function electricAgentsFetch(
  baseUrl: string,
  path: string,
  opts: RequestInit = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: {
      'content-type': `application/json`,
      ...opts.headers,
    },
  })
}

async function pollEntityStatus(
  baseUrl: string,
  entityUrl: string,
  statuses: Array<string>,
  timeoutMs = 8_000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}${entityUrl}`)
    expect(res.status).toBe(200)
    const entity = (await res.json()) as Record<string, unknown>
    if (statuses.includes(String(entity.status))) {
      return entity
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(
    `Timed out waiting for ${entityUrl} to reach one of: ${statuses.join(`, `)}`
  )
}

export function runElectricAgentsConformanceTests(
  config: ElectricAgentsTestOptions
): void {
  // ============================================================================
  // Spawn Tests — Spec: Affordances (Spawn), Constraints C1/C2, Invariants S1/S2/S5
  // ============================================================================

  describe(`Electric Agents Spawn`, () => {
    // Spec: Affordances (Spawn), S5 (stream path convention)
    test(`spawn creates entity and streams`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/spawn-test-agent/**`, `spawn-test-sub`)
        .registerType({
          name: `spawn-test-agent`,
          description: `Test entity type for spawn`,
          creation_schema: { type: `object` },
        })
        .spawn(`spawn-test-agent`, `entity-1`)
        .expectStatus(`running`)
        .custom(async (ctx) => {
          const mainRes = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityStreams!.main}`,
            { method: `HEAD` }
          )
          expect(mainRes.status).toBe(200)

          const errorRes = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityStreams!.error}`,
            { method: `HEAD` }
          )
          expect(errorRes.status).toBe(200)
        })
        .run())

    // Spec: S2, C1
    test(`spawn at unregistered type returns UNKNOWN_ENTITY_TYPE`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/unregistered/entity-1`, {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({}),
          })
          expect(res.status).toBe(404)
          const body = (await res.json()) as { error: { code: string } }
          expect(body.error.code).toBe(`UNKNOWN_ENTITY_TYPE`)
        })
        .skipInvariants()
        .run())

    // Spec: S1, C2
    test(`spawn rejects duplicate URL`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/dup-test-agent/**`, `dup-test-sub`)
        .registerType({
          name: `dup-test-agent`,
          description: `Test entity type for duplicate spawn`,
          creation_schema: { type: `object` },
        })
        .spawn(`dup-test-agent`, `entity-1`)
        .expectSpawnError(`/dup-test-agent/entity-1`, `DUPLICATE_URL`, 409)
        .run())

    // Spec: HTTP API (type is optional)
    test(`spawn without type succeeds`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/notype-test-agent/**`, `notype-test-sub`)
        .registerType({
          name: `notype-test-agent`,
          description: `Test entity type for typeless spawn`,
          creation_schema: { type: `object` },
        })
        .spawn(`notype-test-agent`, `entity-1`)
        .expectStatus(`running`)
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            ctx.currentEntityUrl!
          )
          const entity = await res.json()
          expect(entity.type).toBe(`notype-test-agent`)
        })
        .run())
  })

  // ============================================================================
  // Send Tests — Spec: Affordances (Send), Constraints C3-C6, Invariants S6/S7/S11
  // ============================================================================

  describe(`Electric Agents Send`, () => {
    // Spec: Message Envelope, S11 (ordering)
    test(`send delivers State Protocol message event`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/send-test-worker/**`, `send-test-sub`)
        .registerType({
          name: `send-test-worker`,
          description: `Test entity type for send`,
          creation_schema: { type: `object` },
        })
        .spawn(`send-test-worker`, `entity-1`)
        .send({ task: `hello` }, { from: `user-1` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .expectStreamContains(`message_received`)
        .custom(async (ctx) => {
          const envelope = ctx.lastStreamMessages!.find(
            (m) => m.type === `message_received`
          )!
          expect(envelope.type).toBe(`message_received`)
          expect(envelope.key).toBeDefined()
          expect(envelope.value?.from).toBe(`user-1`)
          expect(envelope.value?.payload).toEqual({ task: `hello` })
        })
        .run())

    // Spec: S6 (entity context on webhooks), Webhook Integration
    test(`send triggers webhook with entity context`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/webhook-ctx-agent/**`, `webhook-ctx-sub`)
        .registerType({
          name: `webhook-ctx-agent`,
          description: `Test entity type for webhook context`,
          creation_schema: { type: `object` },
        })
        .spawn(`webhook-ctx-agent`, `entity-1`)
        .send({ ping: true }, { from: `test` })
        .expectWebhook()
        .expectEntityContext({
          type: `webhook-ctx-agent`,
        })
        .respondDone()
        .run())

    // Spec: C3
    test(`send to nonexistent entity returns 404`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}/nonexistent-type/nonexistent-id/send`,
            {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({ from: `test`, payload: {} }),
            }
          )
          expect(res.status).toBe(404)
        })
        .skipInvariants()
        .run())

    // Spec: S11 (message ordering)
    test(`multiple sends preserve order in stream`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/order-test-agent-${id}/**`, `order-test-sub-${id}`)
        .registerType({
          name: `order-test-agent-${id}`,
          description: `Test entity type for ordering`,
          creation_schema: { type: `object` },
        })
        .spawn(`order-test-agent-${id}`, `entity-1`)
        .send({ seq: 1 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .send({ seq: 2 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .send({ seq: 3 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const msgs = ctx.lastStreamMessages!.filter(
            (m) => m.type === `message_received`
          )
          expect(msgs.length).toBe(3)
          for (let i = 0; i < 3; i++) {
            expect(msgs[i]!.value?.payload).toEqual({ seq: i + 1 })
          }
        })
        .run()
    })

    // Spec: S7, C5
    test(`send without from is rejected`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/nofrom-test-agent/**`, `nofrom-test-sub`)
        .registerType({
          name: `nofrom-test-agent`,
          description: `Test entity type for send without from`,
          creation_schema: { type: `object` },
        })
        .spawn(`nofrom-test-agent`, `entity-1`)
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `${ctx.currentEntityUrl!}/send`,
            {
              method: `POST`,
              body: JSON.stringify({ payload: { hello: true } }),
            }
          )
          expect(res.status).toBe(400)
          const body = await res.json()
          expect(body.error.code).toBe(`INVALID_REQUEST`)
        })
        .run())
  })

  // ============================================================================
  // List Tests — Spec: Affordances (List, Get), Constraints C7
  // ============================================================================

  describe(`Electric Agents List`, () => {
    // Spec: Affordances (List), HTTP API (Electric shape proxy)
    test(`ps lists entities`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/ps-test-worker/**`, `ps-test-worker-sub`)
        .subscription(`/ps-test-agent/**`, `ps-test-agent-sub`)
        .registerType({
          name: `ps-test-worker`,
          description: `Test worker type for ps`,
          creation_schema: { type: `object` },
        })
        .registerType({
          name: `ps-test-agent`,
          description: `Test agent type for ps`,
          creation_schema: { type: `object` },
        })
        .spawn(`ps-test-worker`, `entity-1`)
        .spawn(`ps-test-agent`, `entity-2`)
        .list()
        .expectListCount({ min: 2 })
        .list({ type: `ps-test-agent` })
        .custom(async (ctx) => {
          expect(
            ctx.lastListResult!.every((e) => e.type === `ps-test-agent`)
          ).toBe(true)
        })
        .run())

    // Spec: State Machine (status filtering includes derived idle)
    test(`list with status filter`, () => {
      return electricAgents(config.baseUrl)
        .subscription(`/status-filter-agent/**`, `status-filter-sub`)
        .registerType({
          name: `status-filter-agent`,
          description: `Test entity type for status filter`,
          creation_schema: { type: `object` },
        })
        .spawn(`status-filter-agent`, `entity-1`)
        .spawn(`status-filter-agent`, `entity-2`)
        .kill()
        .list({ status: `stopped` })
        .custom(async (ctx) => {
          expect(ctx.lastListResult!.every((e) => e.status === `stopped`)).toBe(
            true
          )
        })
        .list({ status: `running` })
        .custom(async (ctx) => {
          expect(
            ctx.lastListResult!.every((e) =>
              [`running`, `idle`].includes(e.status)
            )
          ).toBe(true)
        })
        .run()
    })

    // Spec: C7
    test(`get nonexistent entity returns 404`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `/does-not-exist-type/does-not-exist`
          )
          expect(res.status).toBe(404)
        })
        .skipInvariants()
        .run())
  })

  // ============================================================================
  // Kill Tests — Spec: Affordances (Kill), S3/S4/S10, State Machine
  // ============================================================================

  describe(`Electric Agents Kill`, () => {
    // Spec: S3 (no send after kill), S4 (stopped is terminal), C4
    test(`kill stops entity and rejects further sends`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/kill-test-agent/**`, `kill-test-sub`)
        .registerType({
          name: `kill-test-agent`,
          description: `Test entity type for kill`,
          creation_schema: { type: `object` },
        })
        .spawn(`kill-test-agent`, `entity-1`)
        .kill()
        .expectStatus(`stopped`)
        .expectSendError(`NOT_RUNNING`, 409)
        .run())

    // Spec: S10 (kill appends EOF marker), Entity Stopped Marker
    test(`stream data persists after kill`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/kill-persist-agent/**`, `kill-persist-sub`)
        .registerType({
          name: `kill-persist-agent`,
          description: `Test entity type for kill persistence`,
          creation_schema: { type: `object` },
        })
        .spawn(`kill-persist-agent`, `entity-1`)
        .send({ before: `kill` }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .kill()
        .readStream()
        .expectStreamContains(`message_received`)
        .custom(async (ctx) => {
          const msgs = ctx.lastStreamMessages!
          const msgReceived = msgs.find((m) => m.type === `message_received`)!
          expect((msgReceived as any).value?.payload).toEqual({
            before: `kill`,
          })
          const stopped = msgs.find((m) => m.type === `entity_stopped`)
          expect(stopped).toBeDefined()
        })
        .run())

    // Spec: Subscription as Type Definition (shared across entities)
    test.skip(`multiple entities under same subscription`, () => {
      // TODO(durable-scheduler): restore once delete status semantics are reconciled.
      let firstEntityUrl: string | null = null
      let secondEntityUrl: string | null = null
      return electricAgents(config.baseUrl)
        .subscription(`/multi-test-worker/**`, `multi-test-sub`)
        .registerType({
          name: `multi-test-worker`,
          description: `Test entity type for multi-entity`,
          creation_schema: { type: `object` },
        })
        .spawn(`multi-test-worker`, `entity-1`)
        .custom(async (ctx) => {
          firstEntityUrl = ctx.currentEntityUrl
        })
        .spawn(`multi-test-worker`, `entity-2`)
        .custom(async (ctx) => {
          secondEntityUrl = ctx.currentEntityUrl
        })
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(ctx.baseUrl, firstEntityUrl!, {
            method: `DELETE`,
          })
          expect(res.status).toBe(200)
          ctx.history.push({
            type: `entity_killed`,
            entityUrl: firstEntityUrl!,
          })
        })
        .custom(async (ctx) => {
          const res1 = await electricAgentsFetch(ctx.baseUrl, firstEntityUrl!)
          const e1 = await res1.json()
          expect(e1.status).toBe(`stopped`)

          const res2 = await electricAgentsFetch(ctx.baseUrl, secondEntityUrl!)
          const e2 = await res2.json()
          expect([`running`, `idle`]).toContain(e2.status)
        })
        .run()
    })
  })

  // ============================================================================
  // Full E2E — Spec: full lifecycle through all affordances
  // ============================================================================

  describe(`Electric Agents E2E`, () => {
    // Spec: State Machine (spawning → running → stopped), L1 (send triggers wake)
    test(`full lifecycle: spawn → send → webhook → read → kill`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/e2e-test-agent/**`, `e2e-test-sub`)
        .registerType({
          name: `e2e-test-agent`,
          description: `Test entity type for E2E lifecycle`,
          creation_schema: { type: `object` },
        })
        .spawn(`e2e-test-agent`, `entity-1`)
        .expectStatus(`running`)
        .send({ task: `do-something` }, { from: `user-1` })
        .expectWebhook()
        .expectEntityContext({ type: `e2e-test-agent` })
        .respondDone()
        .readStream()
        .expectStreamContains(`message_received`)
        .kill()
        .custom(async (ctx) => {
          const entity = await pollEntityStatus(
            ctx.baseUrl,
            ctx.currentEntityUrl!,
            [`stopped`]
          )
          expect(entity.status).toBe(`stopped`)
        })
        .expectSendError(`NOT_RUNNING`, 409)
        .run())
  })

  // ============================================================================
  // Entity Type Registration — Spec: Entity Type CRUD
  // ============================================================================

  describe(`Electric Agents Entity Type Registration`, () => {
    test(`register entity type`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/reg-type-test/**`, `reg-type-test-sub`)
        .registerType({
          name: `reg-full-type-${Date.now()}`,
          description: `A fully-specified entity type`,
          creation_schema: {
            type: `object`,
            properties: { name: { type: `string` } },
          },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
          output_schemas: {
            result: {
              type: `object`,
              properties: { answer: { type: `string` } },
            },
          },
        })
        .custom(async (ctx) => {
          const typeEvents = ctx.history.filter(
            (h) => h.type === `entity_type_registered`
          )
          expect(typeEvents.length).toBeGreaterThanOrEqual(1)
          const registered = typeEvents[0]!
          expect(registered.type).toBe(`entity_type_registered`)
        })
        .run())

    test(`list entity types`, () => {
      const suffix = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/list-types-test/**`, `list-types-sub`)
        .registerType({
          name: `list-type-a-${suffix}`,
          description: `First type for listing`,
          creation_schema: { type: `object` },
        })
        .registerType({
          name: `list-type-b-${suffix}`,
          description: `Second type for listing`,
          creation_schema: { type: `object` },
        })
        .listTypes()
        .custom(async (ctx) => {
          expect(ctx.lastTypeListResult).toBeDefined()
          const names = ctx.lastTypeListResult!.map((t) => t.name)
          expect(names).toContain(`list-type-a-${suffix}`)
          expect(names).toContain(`list-type-b-${suffix}`)
        })
        .run()
    })

    test(`inspect entity type`, () => {
      const typeName = `inspect-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/inspect-type-test/**`, `inspect-type-sub`)
        .registerType({
          name: typeName,
          description: `Type for inspection`,
          creation_schema: {
            type: `object`,
            properties: { x: { type: `number` } },
          },
          input_schemas: {
            ping: {
              type: `object`,
              properties: { msg: { type: `string` } },
            },
          },
        })
        .inspectType(typeName)
        .custom(async (ctx) => {
          expect(ctx.lastTypeResult).toBeDefined()
          expect(ctx.lastTypeResult!.name).toBe(typeName)
          expect(ctx.lastTypeResult!.creation_schema).toBeDefined()
          expect(ctx.lastTypeResult!.inbox_schemas).toBeDefined()
        })
        .run()
    })

    test(`delete entity type`, () => {
      const typeName = `delete-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/delete-type-test/**`, `delete-type-sub`)
        .registerType({
          name: typeName,
          description: `Type to be deleted`,
          creation_schema: { type: `object` },
        })
        .deleteType(typeName)
        .expectTypeNotExists(typeName)
        .run()
    })

    test(`register upserts duplicate name`, () => {
      const typeName = `dup-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/dup-type-test/**`, `dup-type-sub`)
        .registerType({
          name: typeName,
          description: `First registration`,
          creation_schema: { type: `object` },
        })
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/_electric/entity-types`, {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({
              name: typeName,
              description: `Duplicate registration`,
              creation_schema: { type: `object` },
            }),
          })
          expect(res.status).toBe(201)
          const body = (await res.json()) as {
            name: string
            description: string
            revision: number
          }
          expect(body.name).toBe(typeName)
          expect(body.description).toBe(`Duplicate registration`)
          expect(body.revision).toBe(2)
        })
        .run()
    })

    test(`register rejects missing required fields`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          // Missing name, description, and creation_schema
          const res = await fetch(`${ctx.baseUrl}/_electric/entity-types`, {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({}),
          })
          expect([400, 422]).toContain(res.status)
        })
        .skipInvariants()
        .run())

    test(`register entity type without creation_schema`, () => {
      const typeName = `minimal-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/minimal-type-test/**`, `minimal-type-sub`)
        .registerType({
          name: typeName,
          description: `A minimal entity type with no schemas`,
        })
        .inspectType(typeName)
        .custom(async (ctx) => {
          expect(ctx.lastTypeResult).toBeDefined()
          expect(ctx.lastTypeResult!.name).toBe(typeName)
          expect(ctx.lastTypeResult!.description).toBe(
            `A minimal entity type with no schemas`
          )
        })
        .run()
    })
  })

  // ============================================================================
  // Typed Spawn — Spec: Typed Spawn, Constraints C9/C10
  // ============================================================================

  describe(`Electric Agents Typed Spawn`, () => {
    test(`typed spawn validates creation_schema`, () => {
      const typeName = `typed-spawn-valid-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `typed-spawn-sub`)
        .registerType({
          name: typeName,
          description: `Type with creation schema`,
          creation_schema: {
            type: `object`,
            properties: { topic: { type: `string` } },
            required: [`topic`],
          },
        })
        .spawn(typeName, `entity-1`, { args: { topic: `CRDTs` } })
        .expectStatus(`running`)
        .run()
    })

    test(`typed spawn rejects invalid args (C10)`, () => {
      const typeName = `typed-spawn-invalid-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `typed-spawn-inv-sub`)
        .registerType({
          name: typeName,
          description: `Type with strict creation schema`,
          creation_schema: {
            type: `object`,
            properties: { topic: { type: `string` } },
            required: [`topic`],
          },
        })
        .expectSpawnSchemaError(typeName, `bad-entity-1`, {
          args: { invalid: true },
        })
        .run()
    })

    test(`typed spawn at unregistered type returns UNKNOWN_ENTITY_TYPE (C9)`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/nonexistent/should-fail`, {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({}),
          })
          expect(res.status).toBe(404)
          const body = (await res.json()) as { error: { code: string } }
          expect(body.error.code).toBe(`UNKNOWN_ENTITY_TYPE`)
        })
        .skipInvariants()
        .run())

    test(`spawn with parent`, () => {
      const typeName = `parent-spawn-${Date.now()}`
      let parentUrl: string | null = null
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `parent-spawn-sub`)
        .registerType({
          name: typeName,
          description: `Type for parent-child test`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `parent-entity`)
        .custom(async (ctx) => {
          parentUrl = ctx.currentEntityUrl
        })
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/${typeName}/child-entity`, {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({
              parent: parentUrl,
            }),
          })
          expect(res.status).toBe(201)
          const entity = await res.json()
          ctx.currentEntityUrl = entity.url as string
          ctx.currentEntityStreams = entity.streams as {
            main: string
            error: string
          }
          ctx.currentWriteToken = null
          ctx.history.push({
            type: `entity_spawned`,
            entityUrl: entity.url as string,
            entityType: typeName,
            status: entity.status as string,
            streams: entity.streams as { main: string; error: string },
            parent: parentUrl!,
          })
        })
        .expectStatus(`running`)
        .run()
    })

    test(`spawn with parent rejects missing parent`, () => {
      const typeName = `orphan-spawn-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `orphan-spawn-sub`)
        .registerType({
          name: typeName,
          description: `Type for orphan spawn test`,
          creation_schema: { type: `object` },
        })
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/${typeName}/orphan-entity`, {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({
              parent: `/nonexistent/parent`,
            }),
          })
          expect([400, 404, 422]).toContain(res.status)
        })
        .run()
    })

    test(`spawn with explicit tags sets tags`, () => {
      const typeName = `tags-spawn-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `meta-spawn-sub`)
        .registerType({
          name: typeName,
          description: `Type for tag spawn test`,
        })
        .spawn(typeName, `inst-1`, {
          tags: { color: `blue`, count: `42` },
        })
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}${ctx.currentEntityUrl!}`)
          const entity = (await res.json()) as Record<string, unknown>
          const tags = entity.tags as Record<string, string>
          expect(tags.color).toBe(`blue`)
          expect(tags.count).toBe(`42`)
        })
        .run()
    })

    test(`spawn rejects non-string tags`, () => {
      const id = Date.now()
      const typeName = `tags-invalid-spawn-${id}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-invalid-spawn-sub-${id}`)
        .registerType({
          name: typeName,
          description: `Type with string-only tags`,
        })
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}/${typeName}/should-fail`, {
            method: `PUT`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({ tags: { wrong: 123 } }),
          })
          expect(res.status).toBe(400)
        })
        .run()
    })

    test(`spawn without explicit tags defaults to empty tags`, () => {
      const typeName = `tags-default-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-default-sub`)
        .registerType({
          name: typeName,
          description: `Type with default empty tags`,
        })
        .spawn(typeName, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}${ctx.currentEntityUrl!}`)
          const entity = (await res.json()) as { tags: Record<string, string> }
          expect(entity.tags).toEqual({})
        })
        .run()
    })
  })

  // ============================================================================
  // Schema Validation Gates — Spec: Constraints C11-C15
  // ============================================================================

  describe(`Electric Agents Schema Validation Gates`, () => {
    // --- Send Schema Validation ---

    test(`send validates input_schemas (C11)`, () => {
      const typeName = `send-schema-valid-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `send-schema-sub`)
        .registerType({
          name: typeName,
          description: `Type with input schemas`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .send({ text: `hello` }, { from: `user`, type: `query` })
        .expectWebhook()
        .respondDone()
        .run()
    })

    test(`send rejects invalid typed message (C11)`, () => {
      const typeName = `send-schema-inv-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `send-schema-inv-sub`)
        .registerType({
          name: typeName,
          description: `Type with strict input schemas`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .expectSendSchemaError(
          { invalid: true },
          { from: `user`, type: `query` }
        )
        .run()
    })

    test(`send rejects unknown message type (C13)`, () => {
      const typeName = `send-unknown-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `send-unknown-sub`)
        .registerType({
          name: typeName,
          description: `Type with defined input schemas`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .expectSendUnknownType(
          { text: `hi` },
          { from: `user`, type: `unknown_type` }
        )
        .run()
    })

    test(`send without type when no input_schemas accepts any`, () => {
      const typeName = `send-no-schemas-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `send-noschema-sub`)
        .registerType({
          name: typeName,
          description: `Type without input schemas`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .send({ anything: `goes` }, { from: `user` })
        .expectWebhook()
        .respondDone()
        .run()
    })

    test(`send with empty input_schemas rejects all`, () => {
      const typeName = `send-empty-schemas-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `send-empty-sub`)
        .registerType({
          name: typeName,
          description: `Type with empty input schemas`,
          creation_schema: { type: `object` },
          input_schemas: {},
        })
        .spawn(typeName, `entity-1`)
        .expectSendUnknownType(
          { text: `anything` },
          { from: `user`, type: `some_type` }
        )
        .run()
    })

    // --- Write Endpoint ---

    test.skip(`write appends event to entity stream`, () => {
      const typeName = `write-append-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `write-append-sub`)
        .registerType({
          name: typeName,
          description: `Type for write test`,
          creation_schema: { type: `object` },
          output_schemas: {
            research_result: {
              type: `object`,
              properties: {
                findings: {
                  type: `array`,
                  items: { type: `string` },
                },
              },
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .write({ findings: [`test`] }, { type: `research_result` })
        .readStream()
        .expectStreamContains(`research_result`)
        .run()
    })

    test.skip(`write validates output_schemas (C12)`, () => {
      const typeName = `write-schema-inv-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `write-schema-sub`)
        .registerType({
          name: typeName,
          description: `Type with strict output schemas`,
          creation_schema: { type: `object` },
          output_schemas: {
            result: {
              type: `object`,
              properties: { value: { type: `number` } },
              required: [`value`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .expectWriteSchemaError({ wrong: `type` }, { type: `result` })
        .run()
    })

    test.skip(`write rejects unknown event type (C14)`, () => {
      const typeName = `write-unknown-type-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `write-unknown-sub`)
        .registerType({
          name: typeName,
          description: `Type with defined output schemas`,
          creation_schema: { type: `object` },
          output_schemas: {
            result: {
              type: `object`,
              properties: { value: { type: `number` } },
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .expectWriteUnknownType({ data: `test` }, { type: `unknown_event` })
        .run()
    })

    test.skip(`write without type when no output_schemas accepts any`, () => {
      const typeName = `write-no-schemas-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `write-noschema-sub`)
        .registerType({
          name: typeName,
          description: `Type without output schemas`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .write({ anything: `goes` })
        .run()
    })

    test.skip(`write to stopped entity rejected`, () => {
      const typeName = `write-stopped-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `write-stopped-sub`)
        .registerType({
          name: typeName,
          description: `Type for stopped write test`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .kill()
        .custom(async (ctx) => {
          const writeHeaders: Record<string, string> = {
            'content-type': `application/json`,
          }
          if (ctx.currentWriteToken) {
            writeHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
          }
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/main`,
            {
              method: `POST`,
              headers: writeHeaders,
              body: JSON.stringify({
                type: `test`,
                key: `stopped-test`,
                value: { should: `fail` },
                headers: { operation: `insert` },
              }),
            }
          )
          expect(res.status).toBe(409)
        })
        .run()
    })

    test.skip(`write accepts State Protocol format (type/key/value/headers)`, () => {
      const typeName = `sp-write-agent-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `sp-write-sub`)
        .registerType({
          name: typeName,
          description: `Test State Protocol write format`,
        })
        .spawn(typeName, `sp-w-1`)
        .writeStateProtocol({
          type: `text`,
          key: `msg-1`,
          value: { status: `streaming` },
          headers: { operation: `insert` },
        })
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const textEvent = events.find(
            (e: any) => e.type === `text` && e.key === `msg-1`
          )
          expect(textEvent).toBeDefined()
          expect((textEvent as any).value.status).toBe(`streaming`)
          expect((textEvent as any).headers.operation).toBe(`insert`)
        })
        .kill()
        .run()
    })

    // --- Tags ---

    test.skip(`update tags`, () => {
      const typeName = `tags-update-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-update-sub`)
        .registerType({
          name: typeName,
          description: `Type for tag update test`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .setTags({ owner: `test-user`, priority: `high` })
        .expectTags({ owner: `test-user`, priority: `high` })
        .run()
    })

    test.skip(`tag write rejects non-string values`, () => {
      const typeName = `tags-invalid-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-invalid-sub`)
        .registerType({
          name: typeName,
          description: `Type with string-only tags`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .custom(async (ctx) => {
          const tagHeaders: Record<string, string> = {
            'content-type': `application/json`,
          }
          if (ctx.currentWriteToken) {
            tagHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
          }
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/tags/owner`,
            {
              method: `POST`,
              headers: tagHeaders,
              body: JSON.stringify({ value: 123 }),
            }
          )
          expect(res.status).toBe(400)
        })
        .run()
    })

    test.skip(`tag delete removes a key`, () => {
      const typeName = `tags-delete-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-delete-sub`)
        .registerType({
          name: typeName,
          description: `Type for tag delete test`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .setTags({ owner: `test-user`, priority: `high` })
        .custom(async (ctx) => {
          const tagHeaders: Record<string, string> = {}
          if (ctx.currentWriteToken) {
            tagHeaders.authorization = `Bearer ${ctx.currentWriteToken}`
          }
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/tags/priority`,
            {
              method: `DELETE`,
              headers: tagHeaders,
            }
          )
          expect(res.status).toBe(200)
        })
        .expectTags({ owner: `test-user` })
        .run()
    })

    test.skip(`tag writes merge by key`, () => {
      const typeName = `tags-merge-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `tags-merge-sub`)
        .registerType({
          name: typeName,
          description: `Type for tag merge test`,
          creation_schema: { type: `object` },
        })
        .spawn(typeName, `entity-1`)
        .setTags({ key1: `value1`, key2: `value2` })
        .setTags({ key2: `updated`, key3: `value3` })
        .expectTags({ key1: `value1`, key2: `updated`, key3: `value3` })
        .run()
    })
  })

  // ============================================================================
  // Schema Evolution — Spec: Constraints C16, Revision Pinning
  // ============================================================================

  describe(`Electric Agents Schema Evolution`, () => {
    test(`amend schemas adds new message types`, () => {
      const typeName = `amend-add-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `amend-add-sub`)
        .registerType({
          name: typeName,
          description: `Type for schema amendment`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .amendSchemas(typeName, {
          input_schemas: {
            command: {
              type: `object`,
              properties: { action: { type: `string` } },
              required: [`action`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .send({ action: `do-it` }, { from: `user`, type: `command` })
        .expectWebhook()
        .respondDone()
        .run()
    })

    test(`amend schemas rejects modifying existing keys (C16)`, () => {
      const typeName = `amend-conflict-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `amend-conflict-sub`)
        .registerType({
          name: typeName,
          description: `Type for schema conflict test`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}/_electric/entity-types/${typeName}/schemas`,
            {
              method: `PATCH`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                inbox_schemas: {
                  query: {
                    type: `object`,
                    properties: { text: { type: `number` } },
                  },
                },
              }),
            }
          )
          expect(res.status).toBe(409)
        })
        .run()
    })

    test.skip(`schema amendments apply to existing entities`, () => {
      // TODO(durable-scheduler): restore once schema amendment propagation is fixed.
      const typeName = `rev-pin-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `rev-pin-sub`)
        .registerType({
          name: typeName,
          description: `Type for revision pinning test`,
          creation_schema: { type: `object` },
          input_schemas: {
            query: {
              type: `object`,
              properties: { text: { type: `string` } },
              required: [`text`],
            },
          },
        })
        .spawn(typeName, `entity-1`)
        .custom(async (ctx) => {
          // Amend schemas to add a new key after entity is spawned
          const res = await fetch(
            `${ctx.baseUrl}/_electric/entity-types/${typeName}/schemas`,
            {
              method: `PATCH`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                inbox_schemas: {
                  new_command: {
                    type: `object`,
                    properties: { action: { type: `string` } },
                  },
                },
              }),
            }
          )
          expect(res.status).toBe(200)
        })
        .custom(async (ctx) => {
          // Existing entities pick up newly added schema keys.
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/send`,
            {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                type: `new_command`,
                from: `user`,
                payload: { action: `test` },
              }),
            }
          )
          expect(res.status).toBe(204)
        })
        .run()
    })
  })

  // ============================================================================
  // Serve Endpoint — Spec: Serve Endpoint Registration
  // ============================================================================

  describe(`Electric Agents Serve Endpoint`, () => {
    test(`register type via serve endpoint`, () => {
      const typeName = `serve-reg-${Date.now()}`
      return electricAgents(config.baseUrl)
        .subscription(`/${typeName}/**`, `serve-reg-sub`)
        .registerTypeViaServe({
          name: typeName,
          description: `Type registered via serve endpoint`,
          creation_schema: { type: `object` },
        })
        .expectTypeExists(typeName)
        .run()
    })

    test(`serve endpoint name mismatch rejected`, () =>
      electricAgents(config.baseUrl)
        .custom(async (ctx) => {
          const receiver = new ServeEndpointReceiver()
          const manifest = {
            name: `foo`,
            description: `Manifest says foo`,
            creation_schema: { type: `object` as const },
          }
          await receiver.start(manifest)

          try {
            const res = await fetch(`${ctx.baseUrl}/_electric/entity-types`, {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                name: `bar`,
                serve_endpoint: receiver.url,
              }),
            })
            // The server should reject due to name mismatch
            expect([400, 409, 422]).toContain(res.status)
          } finally {
            await receiver.stop()
          }
        })
        .skipInvariants()
        .run())
  })

  // ============================================================================
  // Property-Based — Spec: S3/S4/S8/S9 (safety invariants across random sequences)
  // ============================================================================

  describe(`Property-Based: Random Action Sequences`, () => {
    const actionArb: fc.Arbitrary<ElectricAgentsAction> = fc.oneof(
      { weight: 15, arbitrary: fc.constant(`register_type` as const) },
      { weight: 5, arbitrary: fc.constant(`delete_type` as const) },
      { weight: 25, arbitrary: fc.constant(`spawn` as const) },
      { weight: 20, arbitrary: fc.constant(`send` as const) },
      { weight: 10, arbitrary: fc.constant(`kill` as const) },
      { weight: 5, arbitrary: fc.constant(`check_status` as const) },
      { weight: 5, arbitrary: fc.constant(`list` as const) }
    )

    test(`random action sequences preserve safety invariants`, async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(actionArb, { minLength: 3, maxLength: 12 }),
          async (actions: Array<ElectricAgentsAction>) => {
            const runId = `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const baseUrl = config.baseUrl

            const entityUrls: Array<string> = []
            const registeredTypeNames: Array<string> = []

            const scenario = electricAgents(baseUrl)

            let model: ElectricAgentsWorldModel = {
              entityTypes: [],
              entities: [],
              nextEntityNum: 0,
            }

            let entityCounter = 0

            for (const action of actions) {
              const valid = enabledElectricAgentsActions(model)
              if (!valid.includes(action)) continue

              switch (action) {
                case `register_type`: {
                  const typeNum = model.entityTypes.length
                  const typeName = `prop-type-${runId}-${typeNum}`
                  registeredTypeNames.push(typeName)
                  scenario.subscription(
                    `/${typeName}/**`,
                    `prop-sub-${typeName}`
                  )
                  scenario.registerType({
                    name: typeName,
                    description: `Property-based test type ${typeNum}`,
                    creation_schema: { type: `object` },
                  })
                  model = applyElectricAgentsAction(model, `register_type`)
                  break
                }

                case `delete_type`: {
                  const runningModelTypeNames = new Set(
                    model.entities
                      .filter((e) => e.status === `running`)
                      .map((e) => e.typeName)
                  )
                  const deletableIndices = model.entityTypes
                    .map((t, i) =>
                      !runningModelTypeNames.has(t.name) ? i : -1
                    )
                    .filter((i) => i >= 0)
                  if (deletableIndices.length === 0) break
                  const deleteIdx = deletableIndices[0]!
                  scenario.deleteType(registeredTypeNames[deleteIdx]!)
                  registeredTypeNames.splice(deleteIdx, 1)
                  model = applyElectricAgentsAction(model, `delete_type`)
                  break
                }

                case `spawn`: {
                  if (registeredTypeNames.length === 0) break
                  const typeName = registeredTypeNames[0]!
                  const instanceId = `entity-${entityCounter++}`
                  scenario.spawn(typeName, instanceId)
                  scenario.custom(async (ctx: RunContext) => {
                    entityUrls.push(ctx.currentEntityUrl!)
                  })
                  model = applyElectricAgentsAction(model, `spawn`)
                  break
                }

                case `send`: {
                  const runningIdxs = model.entities
                    .map((e, i) => (e.status === `running` ? i : -1))
                    .filter((i) => i >= 0)
                  if (runningIdxs.length === 0) break
                  const targetIdx =
                    runningIdxs[Math.floor(Math.random() * runningIdxs.length)]!

                  scenario.custom(async (ctx: RunContext) => {
                    const url = entityUrls[targetIdx]
                    if (!url) return
                    const res = await electricAgentsFetch(
                      ctx.baseUrl,
                      `${url}/send`,
                      {
                        method: `POST`,
                        body: JSON.stringify({
                          from: `prop-test`,
                          payload: { action: `prop-send`, targetIdx },
                        }),
                      }
                    )
                    expect(res.status).toBe(204)
                    ctx.history.push({
                      type: `message_sent`,
                      entityUrl: url,
                      payload: { action: `prop-send`, targetIdx },
                      from: `prop-test`,
                    })
                  })

                  scenario.expectWebhook()
                  scenario.respondDone()

                  model = applyElectricAgentsAction(model, `send`, targetIdx)
                  break
                }

                case `kill`: {
                  const runningIdxs = model.entities
                    .map((e, i) => (e.status === `running` ? i : -1))
                    .filter((i) => i >= 0)
                  if (runningIdxs.length === 0) break
                  const targetIdx =
                    runningIdxs[Math.floor(Math.random() * runningIdxs.length)]!

                  scenario.custom(async (ctx: RunContext) => {
                    const url = entityUrls[targetIdx]
                    if (!url) return
                    const res = await electricAgentsFetch(ctx.baseUrl, url, {
                      method: `DELETE`,
                    })
                    expect(res.status).toBe(200)
                    ctx.history.push({
                      type: `entity_killed`,
                      entityUrl: url,
                    })
                  })

                  model = applyElectricAgentsAction(model, `kill`, targetIdx)
                  break
                }

                case `check_status`: {
                  const anyIdx = model.entities.length > 0 ? 0 : -1
                  if (anyIdx < 0) break
                  const expectedStatus = model.entities[anyIdx]!.status

                  scenario.custom(async (ctx: RunContext) => {
                    const url = entityUrls[anyIdx]
                    if (!url) return
                    const res = await electricAgentsFetch(ctx.baseUrl, url)
                    expect(res.status).toBe(200)
                    const entity = await res.json()
                    if (expectedStatus === `running`) {
                      expect([`running`, `idle`]).toContain(entity.status)
                    } else {
                      expect(entity.status).toBe(expectedStatus)
                    }
                    ctx.history.push({
                      type: `entity_status_checked`,
                      entityUrl: url,
                      status: entity.status as string,
                    })
                  })

                  model = applyElectricAgentsAction(model, `check_status`)
                  break
                }

                case `list`: {
                  scenario.list()
                  model = applyElectricAgentsAction(model, `list`)
                  break
                }
              }
            }

            const history = await scenario.run()
            checkInvariants(history)
          }
        ),
        { numRuns: 15, endOnFailure: true }
      )
    }, 30_000)
  })

  describe.skip(`Electric Agents - StreamDB Materialization`, () => {
    test(`State Protocol events materialize with correct structure`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/mat-test-agent/**`, `mat-test-sub`)
        .registerType({
          name: `mat-test-agent`,
          description: `Test materialization`,
        })
        .spawn(`mat-test-agent`, `mat-1`)
        // Write a complete run lifecycle
        .writeStateProtocol({
          type: `run`,
          key: `run-0`,
          value: { status: `started` },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `step`,
          key: `step-0`,
          value: { status: `started`, step_number: 1 },
          headers: {
            operation: `insert`,
            model_provider: `anthropic`,
            model_id: `claude-sonnet-4-5`,
          },
        })
        .writeStateProtocol({
          type: `text`,
          key: `msg-0`,
          value: { status: `streaming` },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `text_delta`,
          key: `msg-0:0`,
          value: { delta: `Hello `, text_id: `msg-0` },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `text_delta`,
          key: `msg-0:1`,
          value: { delta: `world`, text_id: `msg-0` },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `text`,
          key: `msg-0`,
          value: {
            status: `completed`,
          },
          headers: { operation: `update` },
        })
        .writeStateProtocol({
          type: `step`,
          key: `step-0`,
          value: { status: `completed`, step_number: 1, finish_reason: `stop` },
          headers: {
            operation: `update`,
            duration_ms: 1500,
            token_input: 10,
            token_output: 5,
          },
        })
        .writeStateProtocol({
          type: `run`,
          key: `run-0`,
          value: { status: `completed`, finish_reason: `stop` },
          headers: { operation: `update`, duration_ms: 2000 },
        })
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!

          // Verify event structure
          const spEvents = events.filter(
            (e: any) => e.type && e.key && e.headers
          )

          // E1: run insert before update
          const runEvents = spEvents.filter((e: any) => e.type === `run`)
          expect(runEvents.length).toBe(2)
          expect((runEvents[0] as any).headers.operation).toBe(`insert`)
          expect((runEvents[1] as any).headers.operation).toBe(`update`)

          // E2: step insert before update
          const stepEvents = spEvents.filter((e: any) => e.type === `step`)
          expect(stepEvents.length).toBe(2)
          expect((stepEvents[0] as any).headers.operation).toBe(`insert`)
          expect((stepEvents[1] as any).headers.operation).toBe(`update`)

          // E3: text insert before update
          const textEvents = spEvents.filter((e: any) => e.type === `text`)
          expect(textEvents.length).toBe(2)
          expect((textEvents[0] as any).headers.operation).toBe(`insert`)
          expect((textEvents[1] as any).headers.operation).toBe(`update`)

          // Verify delta ordering
          const deltas = spEvents.filter((e: any) => e.type === `text_delta`)
          expect(deltas.length).toBe(2)
          expect((deltas[0] as any).key).toBe(`msg-0:0`)
          expect((deltas[1] as any).key).toBe(`msg-0:1`)

          // Text completion no longer carries text content; content is in deltas only
          const completedText = textEvents.find(
            (e: any) => e.headers.operation === `update`
          ) as any
          expect(completedText.value.status).toBe(`completed`)

          // Run full invariant check
          checkStateProtocolInvariants(spEvents)
        })
        .kill()
        .run())

    test(`tool call state machine follows started → executing → completed`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/tc-mat-agent/**`, `tc-mat-sub`)
        .registerType({
          name: `tc-mat-agent`,
          description: `Test tool call materialization`,
        })
        .spawn(`tc-mat-agent`, `tc-mat-1`)
        .writeStateProtocol({
          type: `run`,
          key: `run-0`,
          value: { status: `started` },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `step`,
          key: `step-0`,
          value: { status: `started`, step_number: 1 },
          headers: { operation: `insert` },
        })
        // Tool call: started → executing → completed
        .writeStateProtocol({
          type: `tool_call`,
          key: `tc-0`,
          value: {
            tool_name: `web_search`,
            status: `started`,
          },
          headers: { operation: `insert` },
        })
        .writeStateProtocol({
          type: `tool_call`,
          key: `tc-0`,
          value: {
            tool_name: `web_search`,
            status: `executing`,
          },
          headers: { operation: `update` },
        })
        .writeStateProtocol({
          type: `tool_call`,
          key: `tc-0`,
          value: {
            tool_name: `web_search`,
            result: `Search results here`,
            status: `completed`,
          },
          headers: { operation: `update`, duration_ms: 500 },
        })
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const tcEvents = events.filter((e: any) => e.type === `tool_call`)
          expect(tcEvents.length).toBe(3)

          // Verify state machine transitions
          expect((tcEvents[0] as any).value.status).toBe(`started`)
          expect((tcEvents[0] as any).headers.operation).toBe(`insert`)
          expect((tcEvents[1] as any).value.status).toBe(`executing`)
          expect((tcEvents[1] as any).headers.operation).toBe(`update`)
          expect((tcEvents[2] as any).value.status).toBe(`completed`)
          expect((tcEvents[2] as any).headers.operation).toBe(`update`)

          // Run invariant check
          checkStateProtocolInvariants(
            events.filter((e: any) => e.type && e.key && e.headers)
          )
        })
        .kill()
        .run())

    test(`insert creates new entries, update modifies existing entries by key`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/upsert-agent/**`, `upsert-sub`)
        .registerType({
          name: `upsert-agent`,
          description: `Test insert/update semantics`,
        })
        .spawn(`upsert-agent`, `upsert-1`)
        // Insert a text entity
        .writeStateProtocol({
          type: `text`,
          key: `msg-0`,
          value: { status: `streaming` },
          headers: { operation: `insert` },
        })
        // Update same key
        .writeStateProtocol({
          type: `text`,
          key: `msg-0`,
          value: { status: `completed` },
          headers: { operation: `update` },
        })
        // Insert different key
        .writeStateProtocol({
          type: `text`,
          key: `msg-1`,
          value: { status: `streaming` },
          headers: { operation: `insert` },
        })
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const textEvents = events.filter((e: any) => e.type === `text`)
          // 3 events: msg-0 insert, msg-0 update, msg-1 insert
          expect(textEvents.length).toBe(3)

          // Verify distinct keys
          const keys = textEvents.map((e: any) => e.key)
          expect(keys).toContain(`msg-0`)
          expect(keys).toContain(`msg-1`)
        })
        .kill()
        .run())
  })

  describe(`Electric Agents - Tool Tests`, () => {
    /** Extract text from the first content block of a tool result. */
    function firstText(result: { content: Array<{ type: string }> }): string {
      const block = result.content[0] as
        | { type: string; text?: string }
        | undefined
      return block?.type === `text` && block.text ? block.text : ``
    }

    test(`bash tool captures stdout and stderr`, async () => {
      const { createBashTool } = await import(`../../agents-runtime/src/tools`)
      const tool = createBashTool(`/tmp`)
      const result = await tool.execute(`test-tc`, {
        command: `echo "hello" && echo "error" >&2`,
      })
      expect(firstText(result)).toContain(`hello`)
      expect(firstText(result)).toContain(`error`)
      expect(result.details.exitCode).toBe(0)
    })

    test(`bash tool enforces timeout`, async () => {
      const { createBashTool } = await import(`../../agents-runtime/src/tools`)
      const tool = createBashTool(`/tmp`)
      const result = await tool.execute(`test-tc`, { command: `sleep 60` })
      expect(result.details.timedOut).toBe(true)
    }, 35_000)

    test(`read_file rejects paths outside working directory`, async () => {
      const { createReadFileTool } = await import(
        `../../agents-runtime/src/tools`
      )
      const tool = createReadFileTool(`/tmp/test-workdir`)
      const result = await tool.execute(`test-tc`, { path: `../../etc/passwd` })
      expect(firstText(result)).toContain(`outside the working directory`)
    })

    test(`read_file rejects binary files`, async () => {
      const { createReadFileTool } = await import(
        `../../agents-runtime/src/tools`
      )
      const fs = await import(`node:fs/promises`)
      const path = await import(`node:path`)

      // Create a temp binary file
      const dir = `/tmp/test-binary-${Date.now()}`
      await fs.mkdir(dir, { recursive: true })
      const binPath = path.join(dir, `test.bin`)
      await fs.writeFile(binPath, Buffer.from([0x00, 0x01, 0x02, 0xff]))

      const tool = createReadFileTool(dir)
      const result = await tool.execute(`test-tc`, { path: `test.bin` })
      expect(firstText(result)).toContain(`binary file`)

      await fs.rm(dir, { recursive: true })
    })

    test(`read_file rejects oversized files`, async () => {
      const { createReadFileTool } = await import(
        `../../agents-runtime/src/tools`
      )
      const fs = await import(`node:fs/promises`)
      const path = await import(`node:path`)

      const dir = `/tmp/test-size-${Date.now()}`
      await fs.mkdir(dir, { recursive: true })
      const bigPath = path.join(dir, `big.txt`)
      // Write 600KB file (over 512KB limit)
      await fs.writeFile(bigPath, `x`.repeat(600 * 1024))

      const tool = createReadFileTool(dir)
      const result = await tool.execute(`test-tc`, { path: `big.txt` })
      expect(firstText(result)).toContain(`too large`)

      await fs.rm(dir, { recursive: true })
    })

    test(`web_search tool has correct interface`, async () => {
      const { braveSearchTool } = await import(`../../agents-runtime/src/tools`)
      expect(braveSearchTool.name).toBe(`web_search`)
      expect(typeof braveSearchTool.execute).toBe(`function`)
    })

    test(`fetch_url tool has correct interface`, async () => {
      const { fetchUrlTool } = await import(`../../agents-runtime/src/tools`)
      expect(fetchUrlTool.name).toBe(`fetch_url`)
      expect(typeof fetchUrlTool.execute).toBe(`function`)
    })
  })

  // ==========================================================================
  // Send — State Protocol Format
  // ==========================================================================

  describe(`Electric Agents Send — State Protocol Format`, () => {
    test(`send() writes events in State Protocol format`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/sp-send-worker/**`, `sp-send-sub`)
        .registerType({
          name: `sp-send-worker`,
          description: `Test entity type for SP send format`,
          creation_schema: { type: `object` },
        })
        .spawn(`sp-send-worker`, `entity-1`)
        .send({ text: `hello world` }, { from: `user-1` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const msgEvent = events.find((e) => e.type === `message_received`)!
          // State Protocol format — from/payload in value, headers present
          expect(msgEvent.type).toBe(`message_received`)
          expect(msgEvent.key).toBeDefined()
          expect(msgEvent.value?.from).toBe(`user-1`)
          expect(msgEvent.value?.payload).toEqual({ text: `hello world` })
          expect(msgEvent.headers).toBeDefined()
        })
        .run())

    test(`send() events pass State Protocol invariant checks`, () =>
      electricAgents(config.baseUrl)
        .subscription(`/sp-inv-worker/**`, `sp-inv-sub`)
        .registerType({
          name: `sp-inv-worker`,
          description: `Test entity type for SP invariant checks`,
          creation_schema: { type: `object` },
        })
        .spawn(`sp-inv-worker`, `entity-1`)
        .send({ text: `first` }, { from: `tester` })
        .expectWebhook()
        .respondDone()
        .send({ text: `second` }, { from: `tester` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const messageEvents = events.filter(
            (ev) => ev.type === `message_received`
          )
          expect(messageEvents.length).toBe(2)
          // All events are State Protocol format — verify invariants
          checkStateProtocolInvariants(events)
        })
        .run())

    test(`multiple sends produce unique sequential keys`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/sp-keys-agent-${id}/**`, `sp-keys-sub-${id}`)
        .registerType({
          name: `sp-keys-agent-${id}`,
          description: `Test entity type for send key uniqueness`,
          creation_schema: { type: `object` },
        })
        .spawn(`sp-keys-agent-${id}`, `entity-1`)
        .send({ seq: 1 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .send({ seq: 2 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .send({ seq: 3 }, { from: `test` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!.filter(
            (e) => e.type === `message_received`
          )
          expect(events.length).toBe(3)

          // Ordering preserved in values
          for (let i = 0; i < 3; i++) {
            expect((events[i]! as any).value?.payload).toEqual({ seq: i + 1 })
          }
        })
        .run()
    })
  })

  // ==========================================================================
  // findLastUserMessage — State Protocol parsing
  // ==========================================================================

  describe(`Electric Agents findLastUserMessage — State Protocol`, () => {
    test(`send event is parseable by webhook handler`, () => {
      // Integration test: send a message, read stream, verify it's State Protocol
      // This tests the contract that findLastUserMessage depends on
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/flum-agent-${id}/**`, `flum-sub-${id}`)
        .registerType({
          name: `flum-agent-${id}`,
          description: `Test send event format for webhook parsing`,
          creation_schema: { type: `object` },
        })
        .spawn(`flum-agent-${id}`, `entity-1`)
        .send({ text: `test message for parsing` }, { from: `tester` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          const msgEvent = events.find((e) => e.type === `message_received`)!
          expect(msgEvent).toBeDefined()
          // State Protocol — payload inside value
          expect((msgEvent as any).value?.payload).toBeDefined()
          const payload = (msgEvent as any).value!.payload as Record<
            string,
            unknown
          >
          expect(payload.text).toBe(`test message for parsing`)
        })
        .run()
    })

    test(`stream events after send are all State Protocol format`, () => {
      // After send + webhook done, ALL events in the stream should be SP format.
      // No legacy flat envelopes should appear.
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/flum-all-agent-${id}/**`, `flum-all-sub-${id}`)
        .registerType({
          name: `flum-all-agent-${id}`,
          description: `Test all events are SP format`,
          creation_schema: { type: `object` },
        })
        .spawn(`flum-all-agent-${id}`, `entity-1`)
        .send({ text: `verify all SP` }, { from: `tester` })
        .expectWebhook()
        .respondDone()
        .readStream()
        .custom(async (ctx) => {
          const events = ctx.lastStreamMessages!
          expect(events.length).toBeGreaterThanOrEqual(1)
          // Stream should contain a message_received event
          const hasMsg = events.some((e) => e.type === `message_received`)
          expect(hasMsg).toBe(true)
          // All events should be State Protocol format
          for (const ev of events) {
            expect(ev.type, `every event must have type`).toBeDefined()
            expect(ev.key, `SP events must have key`).toBeDefined()
            expect(ev.headers, `SP events must have headers`).toBeDefined()
          }
        })
        .run()
    })
  })

  // ============================================================================
  // Error Path Tests
  // ============================================================================

  describe(`Error Paths`, () => {
    test(`kill nonexistent entity with registered type returns 404`, async () => {
      const typeName = `kill-miss-${Date.now()}`
      await electricAgentsFetch(config.baseUrl, `/_electric/entity-types`, {
        method: `POST`,
        body: JSON.stringify({ name: typeName, description: `test` }),
      })
      const res = await electricAgentsFetch(
        config.baseUrl,
        `/${typeName}/nonexistent-id-12345`,
        { method: `DELETE` }
      )
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe(`NOT_FOUND`)
    })

    test.skip(`kill already-stopped entity is idempotent`, () => {
      // TODO(durable-scheduler): restore once repeated delete status semantics are reconciled.
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/kill-stopped-agent-${id}/**`, `kill-stopped-sub-${id}`)
        .registerType({
          name: `kill-stopped-agent-${id}`,
          description: `Test killing stopped entity`,
          creation_schema: { type: `object` },
        })
        .spawn(`kill-stopped-agent-${id}`, `entity-1`)
        .kill()
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            ctx.currentEntityUrl!,
            {
              method: `DELETE`,
            }
          )
          expect(res.status).toBe(200)
        })
        .run()
    })

    test(`send without payload is rejected`, async () => {
      const id = Date.now()
      await electricAgents(config.baseUrl)
        .subscription(`/no-payload-agent-${id}/**`, `no-payload-sub-${id}`)
        .registerType({
          name: `no-payload-agent-${id}`,
          description: `Test send without payload`,
          creation_schema: { type: `object` },
        })
        .spawn(`no-payload-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `${ctx.currentEntityUrl!}/send`,
            {
              method: `POST`,
              body: JSON.stringify({ from: `tester` }),
            }
          )
          expect(res.status).toBe(400)
          const body = (await res.json()) as { error: { code: string } }
          expect(body.error.code).toBe(`INVALID_REQUEST`)
        })
        .run()
    })

    test(`delete nonexistent entity type returns 404`, async () => {
      const res = await electricAgentsFetch(
        config.baseUrl,
        `/_electric/entity-types/nonexistent-type-xyz`,
        { method: `DELETE` }
      )
      expect(res.status).toBe(404)
    })

    test(`delete entity type goes through state stream`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/del-state-agent-${id}/**`, `del-state-sub-${id}`)
        .registerType({
          name: `del-state-agent-${id}`,
          description: `Test delete via state stream`,
          creation_schema: { type: `object` },
        })
        .deleteType(`del-state-agent-${id}`)
        .custom(async (ctx) => {
          // Verify the type was deleted
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `/_electric/entity-types/del-state-agent-${id}`
          )
          expect(res.status).toBe(404)
        })
        .run()
    })

    test(`tag update on stopped entity`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/meta-stopped-agent-${id}/**`, `meta-stopped-sub-${id}`)
        .registerType({
          name: `meta-stopped-agent-${id}`,
          description: `Test tag write on stopped entity`,
          creation_schema: { type: `object` },
        })
        .spawn(`meta-stopped-agent-${id}`, `entity-1`)
        .kill()
        .custom(async (ctx) => {
          const tagHeaders: Record<string, string> = {}
          if (ctx.currentWriteToken) {
            tagHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
          }
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `${ctx.currentEntityUrl!}/tags/key`,
            {
              method: `POST`,
              headers: tagHeaders,
              body: JSON.stringify({ value: `value` }),
            }
          )
          expect(res.status).toBe(409)
        })
        .run()
    })
  })

  // ============================================================================
  // Type Revision Edge Cases
  // ============================================================================

  describe(`Type Revision Edge Cases`, () => {
    test(`existing entities accept schemas added across multiple amendments`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/rev-multi-agent-${id}/**`, `rev-multi-sub-${id}`)
        .registerType({
          name: `rev-multi-agent-${id}`,
          description: `Test multi-revision pinning`,
          creation_schema: { type: `object` },
          input_schemas: {
            greet: {
              type: `object`,
              properties: { name: { type: `string` } },
              required: [`name`],
            },
          },
        })
        .spawn(`rev-multi-agent-${id}`, `entity-rev1`)
        .custom(async (ctx) => {
          const rev1EntityUrl = ctx.currentEntityUrl

          await electricAgentsFetch(
            ctx.baseUrl,
            `/_electric/entity-types/rev-multi-agent-${id}/schemas`,
            {
              method: `PATCH`,
              body: JSON.stringify({
                inbox_schemas: {
                  farewell: {
                    type: `object`,
                    properties: { reason: { type: `string` } },
                    required: [`reason`],
                  },
                },
              }),
            }
          )

          // Amend to revision 3
          await electricAgentsFetch(
            ctx.baseUrl,
            `/_electric/entity-types/rev-multi-agent-${id}/schemas`,
            {
              method: `PATCH`,
              body: JSON.stringify({
                inbox_schemas: {
                  status: {
                    type: `object`,
                    properties: { active: { type: `boolean` } },
                  },
                },
              }),
            }
          )

          // Existing entities pick up schema keys added by later amendments.
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `${rev1EntityUrl}/send`,
            {
              method: `POST`,
              body: JSON.stringify({
                from: `tester`,
                payload: { reason: `bye` },
                type: `farewell`,
              }),
            }
          )
          expect(res.status).toBe(204)
        })
        .run()
    })

    test(`amend schemas on deleted type returns 404`, async () => {
      const id = Date.now()
      await electricAgents(config.baseUrl)
        .subscription(`/amend-del-agent-${id}/**`, `amend-del-sub-${id}`)
        .registerType({
          name: `amend-del-agent-${id}`,
          description: `Test amend on deleted type`,
          creation_schema: { type: `object` },
        })
        .deleteType(`amend-del-agent-${id}`)
        .custom(async (ctx) => {
          const res = await electricAgentsFetch(
            ctx.baseUrl,
            `/_electric/entity-types/amend-del-agent-${id}/schemas`,
            {
              method: `PATCH`,
              body: JSON.stringify({
                input_schemas: {
                  msg: { type: `object` },
                },
              }),
            }
          )
          expect(res.status).toBe(404)
        })
        .run()
    })
  })

  // ============================================================================
  // Concurrent Operations
  // ============================================================================

  describe(`Concurrent Operations`, () => {
    test(`sequential tag updates accumulate`, async () => {
      const id = Date.now()
      await electricAgents(config.baseUrl)
        .subscription(`/seq-meta-agent-${id}/**`, `seq-meta-sub-${id}`)
        .registerType({
          name: `seq-meta-agent-${id}`,
          description: `Test sequential tag updates`,
          creation_schema: { type: `object` },
        })
        .spawn(`seq-meta-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const tagHeaders: Record<string, string> = {}
          if (ctx.currentWriteToken) {
            tagHeaders[`authorization`] = `Bearer ${ctx.currentWriteToken}`
          }
          const r1 = await electricAgentsFetch(
            ctx.baseUrl,
            `${ctx.currentEntityUrl!}/tags/key1`,
            {
              method: `POST`,
              headers: tagHeaders,
              body: JSON.stringify({ value: `value1` }),
            }
          )
          expect(r1.status).toBe(200)

          const r2 = await electricAgentsFetch(
            ctx.baseUrl,
            `${ctx.currentEntityUrl!}/tags/key2`,
            {
              method: `POST`,
              headers: tagHeaders,
              body: JSON.stringify({ value: `value2` }),
            }
          )
          expect(r2.status).toBe(200)

          const getRes = await electricAgentsFetch(
            ctx.baseUrl,
            ctx.currentEntityUrl!
          )
          const entity = (await getRes.json()) as {
            tags: Record<string, string>
          }
          expect(entity.tags.key1).toBe(`value1`)
          expect(entity.tags.key2).toBe(`value2`)
        })
        .run()
    })

    test(`concurrent spawns under same type succeed`, async () => {
      const id = Date.now()
      await electricAgents(config.baseUrl)
        .subscription(`/conc-spawn-agent-${id}/**`, `conc-spawn-sub-${id}`)
        .registerType({
          name: `conc-spawn-agent-${id}`,
          description: `Test concurrent spawns`,
          creation_schema: { type: `object` },
        })
        .custom(async (ctx) => {
          const results = await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
              electricAgentsFetch(
                ctx.baseUrl,
                `/conc-spawn-agent-${id}/concurrent-${i}`,
                {
                  method: `PUT`,
                  body: JSON.stringify({}),
                }
              )
            )
          )
          for (const res of results) {
            expect(res.status).toBe(201)
          }
          for (let i = 0; i < 5; i++) {
            const res = await electricAgentsFetch(
              ctx.baseUrl,
              `/conc-spawn-agent-${id}/concurrent-${i}`
            )
            expect(res.status).toBe(200)
          }
        })
        .run()
    })
  })

  // ============================================================================
  // Auth Boundary — Spec: write_token security, token leak prevention
  // ============================================================================

  describe(`Electric Agents Auth Boundary`, () => {
    test(`write to entity stream without token is rejected`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/auth-notoken-agent-${id}/**`, `auth-notoken-sub-${id}`)
        .registerType({
          name: `auth-notoken-agent-${id}`,
          description: `Test write without token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-notoken-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/main`,
            {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                type: `default`,
                key: `test-${Date.now()}`,
                value: { data: `should-fail` },
                headers: { operation: `insert` },
              }),
            }
          )
          expect(res.status).toBe(401)
        })
        .run()
    })

    test(`write to entity stream with wrong token is rejected`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-wrongtoken-agent-${id}/**`,
          `auth-wrongtoken-sub-${id}`
        )
        .registerType({
          name: `auth-wrongtoken-agent-${id}`,
          description: `Test write with wrong token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-wrongtoken-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/main`,
            {
              method: `POST`,
              headers: {
                'content-type': `application/json`,
                authorization: `Bearer wrong-token`,
              },
              body: JSON.stringify({
                type: `default`,
                key: `test-${Date.now()}`,
                value: { data: `should-fail` },
                headers: { operation: `insert` },
              }),
            }
          )
          expect(res.status).toBe(401)
        })
        .run()
    })

    test(`spawn does not expose a public entity write token`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-goodtoken-agent-${id}/**`,
          `auth-goodtoken-sub-${id}`
        )
        .registerType({
          name: `auth-goodtoken-agent-${id}`,
          description: `Test write with correct token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-goodtoken-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          expect(ctx.currentWriteToken).toBeNull()
        })
        .run()
    })

    test(`tag update without token is rejected`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-meta-notoken-agent-${id}/**`,
          `auth-meta-notoken-sub-${id}`
        )
        .registerType({
          name: `auth-meta-notoken-agent-${id}`,
          description: `Test tag update without token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-meta-notoken-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/tags/key`,
            {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({ value: `value` }),
            }
          )
          expect(res.status).toBe(401)
        })
        .run()
    })

    test(`spawn does not expose a public tag write token`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-meta-goodtoken-agent-${id}/**`,
          `auth-meta-goodtoken-sub-${id}`
        )
        .registerType({
          name: `auth-meta-goodtoken-agent-${id}`,
          description: `Test tag update with correct token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-meta-goodtoken-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          expect(ctx.currentWriteToken).toBeNull()
        })
        .run()
    })

    test(`send remains unauthenticated`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-send-noauth-agent-${id}/**`,
          `auth-send-noauth-sub-${id}`
        )
        .registerType({
          name: `auth-send-noauth-agent-${id}`,
          description: `Test send without auth`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-send-noauth-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(
            `${ctx.baseUrl}${ctx.currentEntityUrl!}/send`,
            {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({ from: `tester`, payload: `hi` }),
            }
          )
          expect(res.status).toBe(204)
        })
        .expectWebhook()
        .respondDone()
        .run()
    })

    test(`GET entity does not leak write_token`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(`/auth-noleak-agent-${id}/**`, `auth-noleak-sub-${id}`)
        .registerType({
          name: `auth-noleak-agent-${id}`,
          description: `Test GET does not leak write_token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-noleak-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const res = await fetch(`${ctx.baseUrl}${ctx.currentEntityUrl!}`)
          expect(res.status).toBe(200)
          const entity = await res.json()
          expect(entity.write_token).toBeUndefined()
          expect(entity.subscription_id).toBeUndefined()
        })
        .run()
    })

    test.skip(`list entities does not leak write_token`, () => {
      const id = Date.now()
      return electricAgents(config.baseUrl)
        .subscription(
          `/auth-listnoleak-agent-${id}/**`,
          `auth-listnoleak-sub-${id}`
        )
        .registerType({
          name: `auth-listnoleak-agent-${id}`,
          description: `Test list does not leak write_token`,
          creation_schema: { type: `object` },
        })
        .spawn(`auth-listnoleak-agent-${id}`, `entity-1`)
        .custom(async (ctx) => {
          const entities = await fetchShapeRows<Record<string, unknown>>(
            ctx.baseUrl,
            `entities`
          )
          for (const entity of entities) {
            expect(entity).not.toHaveProperty(`write_token`)
            expect(entity).not.toHaveProperty(`subscription_id`)
          }
        })
        .run()
    })

    test(`write to non-entity stream requires no auth`, async () => {
      const id = Date.now()
      const streamPath = `/v1/stream/plain-stream-auth-test-${id}`

      // Create a regular stream
      const createRes = await fetch(`${config.baseUrl}${streamPath}`, {
        method: `PUT`,
        headers: { 'Content-Type': `text/plain` },
        body: `initial data`,
      })
      expect(createRes.status).toBe(201)

      // Write to it without any auth header
      const writeRes = await fetch(`${config.baseUrl}${streamPath}`, {
        method: `POST`,
        headers: { 'Content-Type': `text/plain` },
        body: ` more data`,
      })
      expect([200, 204].includes(writeRes.status)).toBe(true)
    })
  })
}

// ============================================================================
// CLI Conformance Tests
// ============================================================================

export interface CliTestOptions {
  baseUrl: string
  cliBin: string
}

export function runCliConformanceTests(config: CliTestOptions): void {
  // ============================================================================
  // Basic Commands
  // ============================================================================

  describe(`CLI — Entity Types`, () => {
    test(`types lists registered types`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-types-test`,
          description: `Type for CLI types test`,
        })
        .exec(`types`)
        .expectExitCode(0)
        .expectStdout(/cli-types-test/)
        .expectStdout(/Type for CLI types test/)
        .run()
    })

    test(`types inspect shows type details`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-inspect-type`,
          description: `Type for CLI inspect test`,
        })
        .exec(`types`, `inspect`, `cli-inspect-type`)
        .expectExitCode(0)
        .expectStdout(/cli-inspect-type/)
        .run()
    })

    test(`types inspect nonexistent type fails`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`types`, `inspect`, `nonexistent-type-xyz`)
        .expectExitCode(1)
        .expectStderr(/Error/)
        .run()
    })

    test(`types delete removes type`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-delete-type`,
          description: `Type to delete`,
        })
        .exec(`types`, `delete`, `cli-delete-type`)
        .expectExitCode(0)
        .expectStdout(/Deleted/)
        .exec(`types`)
        .expectStdoutNot(/cli-delete-type/)
        .run()
    })
  })

  describe(`CLI — Spawn`, () => {
    test(`spawn creates entity and reports URL`, async () => {
      const id = `cli-spawn-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-spawn-type`,
          description: `Type for CLI spawn test`,
        })
        .setupSubscription(`/cli-spawn-type/**`, `cli-spawn-sub`)
        .exec(`spawn`, `/cli-spawn-type/${id}`)
        .expectExitCode(0)
        .expectStdout(/Spawned/)
        // Verify via API that the entity actually exists
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/cli-spawn-type/${id}`)
          expect(res.status).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>
          expect([`running`, `idle`]).toContain(entity.status)
        })
        .run()
    })

    test(`spawn with --args passes arguments`, async () => {
      const id = `cli-args-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-args-type`,
          description: `Type for CLI args test`,
          creation_schema: { type: `object` },
        })
        .setupSubscription(`/cli-args-type/**`, `cli-args-sub`)
        .exec(`spawn`, `/cli-args-type/${id}`, `--args`, `{"key":"value"}`)
        .expectExitCode(0)
        .expectStdout(/Spawned/)
        .run()
    })

    test(`spawn unregistered type exits non-zero`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`spawn`, `/nonexistent-type-xyz/some-id`)
        .expectExitCode(1)
        .custom((last) => {
          expect(`${last.stdout}\n${last.stderr}`).toMatch(
            /Entity type "nonexistent-type-xyz" not found/
          )
        })
        .run()
    })
  })

  describe(`CLI — Process Listing (ps)`, () => {
    test(`ps lists spawned entities`, async () => {
      const id = `cli-ps-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-ps-type`,
          description: `Type for CLI ps test`,
        })
        .setupSubscription(`/cli-ps-type/**`, `cli-ps-sub`)
        .exec(`spawn`, `/cli-ps-type/${id}`)
        .expectExitCode(0)
        .exec(`ps`)
        .expectExitCode(0)
        .expectStdout(/cli-ps-type/)
        .run()
    })

    test(`ps --type filters by entity type`, async () => {
      const id = `cli-filter-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-filter-type`,
          description: `Type for CLI filter test`,
        })
        .setupSubscription(`/cli-filter-type/**`, `cli-filter-sub`)
        .exec(`spawn`, `/cli-filter-type/${id}`)
        .expectExitCode(0)
        .exec(`ps`, `--type`, `cli-filter-type`)
        .expectExitCode(0)
        .expectStdout(/cli-filter-type/)
        .run()
    })
  })

  describe(`CLI — Send`, () => {
    test(`send delivers message and verifies stream`, async () => {
      const id = `cli-send-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-send-type`,
          description: `Type for CLI send test`,
        })
        .setupSubscription(`/cli-send-type/**`, `cli-send-sub`)
        .exec(`spawn`, `/cli-send-type/${id}`)
        .expectExitCode(0)
        .exec(`send`, `/cli-send-type/${id}`, `hello world`)
        .expectExitCode(0)
        .expectStdout(/Message sent/)
        // Verify the message actually landed in the stream via API
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/cli-send-type/${id}`)
          expect(res.status).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>
          const streams = entity.streams as { main: string }
          const streamRes = await fetch(
            `${baseUrl}${streams.main}?offset=0000000000000000_0000000000000000`
          )
          const events = (await streamRes.json()) as Array<
            Record<string, unknown>
          >
          expect(events.length).toBeGreaterThanOrEqual(1)
          // Should contain a State Protocol message_received event
          const msgEvent = events.find(
            (e: any) => e.type === `message_received`
          )!
          expect(msgEvent).toBeDefined()
          const payload = (msgEvent as any).value?.payload as Record<
            string,
            unknown
          >
          expect(payload.text).toBe(`hello world`)
        })
        .run()
    })

    test(`send to nonexistent entity fails`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`send`, `/nonexistent/entity`, `hello`)
        .expectExitCode(1)
        .expectStderr(/Error/)
        .run()
    })
  })

  describe(`CLI — Inspect`, () => {
    test(`inspect shows entity details`, async () => {
      const id = `cli-inspect-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-inspect-etype`,
          description: `Type for CLI inspect test`,
        })
        .setupSubscription(`/cli-inspect-etype/**`, `cli-inspect-sub`)
        .exec(`spawn`, `/cli-inspect-etype/${id}`)
        .expectExitCode(0)
        .exec(`inspect`, `/cli-inspect-etype/${id}`)
        .expectExitCode(0)
        .expectStdout(/running|idle/)
        // Verify API agrees with CLI output
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/cli-inspect-etype/${id}`)
          expect(res.status).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>
          expect([`running`, `idle`]).toContain(entity.status)
        })
        .run()
    })

    test(`inspect nonexistent entity fails`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`inspect`, `/nonexistent/entity`)
        .expectExitCode(1)
        .expectStderr(/Error/)
        .run()
    })
  })

  describe(`CLI — Kill`, () => {
    test(`kill stops a running entity`, async () => {
      const id = `cli-kill-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-kill-type`,
          description: `Type for CLI kill test`,
        })
        .setupSubscription(`/cli-kill-type/**`, `cli-kill-sub`)
        .exec(`spawn`, `/cli-kill-type/${id}`)
        .expectExitCode(0)
        .exec(`kill`, `/cli-kill-type/${id}`)
        .expectExitCode(0)
        .expectStdout(/Killed/)
        // Verify API confirms the entity is stopped
        .verifyApi(async (baseUrl) => {
          const entity = await pollEntityStatus(
            baseUrl,
            `/cli-kill-type/${id}`,
            [`stopped`]
          )
          expect(entity.status).toBe(`stopped`)
        })
        .run()
    }, 15_000)

    test(`kill nonexistent entity fails`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`kill`, `/nonexistent/entity`)
        .expectExitCode(1)
        .expectStderr(/Error/)
        .run()
    })
  })

  describe(`CLI — Full Lifecycle`, () => {
    test(`spawn → send → inspect → kill with API verification`, async () => {
      const id = `cli-lifecycle-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-lifecycle-type`,
          description: `Type for full lifecycle test`,
        })
        .setupSubscription(`/cli-lifecycle-type/**`, `cli-lifecycle-sub`)
        .exec(`spawn`, `/cli-lifecycle-type/${id}`)
        .expectExitCode(0)
        .expectStdout(/Spawned/)
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/cli-lifecycle-type/${id}`)
          expect(res.status, `entity should exist after spawn`).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>
          expect([`running`, `idle`]).toContain(entity.status)
        })
        .exec(`send`, `/cli-lifecycle-type/${id}`, `test message`)
        .expectExitCode(0)
        .expectStdout(/Message sent/)
        .exec(`inspect`, `/cli-lifecycle-type/${id}`)
        .expectExitCode(0)
        .expectStdout(/running|idle/)
        .exec(`kill`, `/cli-lifecycle-type/${id}`)
        .expectExitCode(0)
        .expectStdout(/Killed/)
        .verifyApi(async (baseUrl) => {
          const entity = await pollEntityStatus(
            baseUrl,
            `/cli-lifecycle-type/${id}`,
            [`stopped`]
          )
          expect(entity.status).toBe(`stopped`)
        })
        .exec(`ps`, `--status`, `running`)
        .expectExitCode(0)
        .expectStdoutNot(new RegExp(id))
        .run()
    }, 15_000)

    test(`send to stopped entity fails`, async () => {
      const id = `cli-stopped-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .setupType({
          name: `cli-stopped-type`,
          description: `Type for stopped entity test`,
        })
        .setupSubscription(`/cli-stopped-type/**`, `cli-stopped-sub`)
        .exec(`spawn`, `/cli-stopped-type/${id}`)
        .expectExitCode(0)
        .exec(`kill`, `/cli-stopped-type/${id}`)
        .expectExitCode(0)
        .exec(`send`, `/cli-stopped-type/${id}`, `should fail`)
        .expectExitCode(1)
        .expectStderr(/Error/)
        .run()
    })
  })

  describe(`CLI — Usage Errors`, () => {
    test(`no arguments shows usage`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec()
        .expectExitCode(1)
        .run()
    })

    test(`spawn without arguments shows usage`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`spawn`)
        .expectExitCode(1)
        .run()
    })

    test(`send without URL shows usage`, async () => {
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`send`)
        .expectExitCode(1)
        .run()
    })
  })
}

// ============================================================================
// Mock Agent Integration Tests
// ============================================================================

export interface MockAgentTestOptions {
  baseUrl: string
}

export function runMockAgentTests(config: MockAgentTestOptions): void {
  async function spawnEntity(
    baseUrl: string,
    typeName: string,
    instanceId: string
  ): Promise<Record<string, unknown>> {
    const res = await fetch(
      `${baseUrl}/${encodeURIComponent(typeName)}/${encodeURIComponent(instanceId)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({}),
      }
    )
    expect(res.ok, `spawn should succeed: ${res.status}`).toBe(true)
    return (await res.json()) as Record<string, unknown>
  }

  async function sendMessage(
    baseUrl: string,
    entityUrl: string,
    text: string
  ): Promise<void> {
    const res = await fetch(`${baseUrl}${entityUrl}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ payload: { text }, from: `tester` }),
    })
    expect(
      res.ok || res.status === 204,
      `send should succeed: ${res.status}`
    ).toBe(true)
  }

  async function killEntity(baseUrl: string, entityUrl: string): Promise<void> {
    await fetch(`${baseUrl}${entityUrl}`, {
      method: `DELETE`,
    })
  }

  async function pollForAgentResponse(
    baseUrl: string,
    entityUrl: string,
    timeoutMs = 10_000
  ): Promise<Array<Record<string, unknown>>> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const entityRes = await fetch(`${baseUrl}${entityUrl}`)
      if (!entityRes.ok) throw new Error(`Entity ${entityUrl} not found`)
      const entity = (await entityRes.json()) as Record<string, unknown>

      const streams = entity.streams as { main: string }
      const streamRes = await fetch(
        `${baseUrl}${streams.main}?offset=0000000000000000_0000000000000000`
      )
      const events = (await streamRes.json()) as Array<Record<string, unknown>>

      const hasRunComplete = events.some(
        (e) =>
          e.type === `run` &&
          (e.headers as Record<string, unknown> | undefined)?.operation ===
            `update`
      )
      if (hasRunComplete) return events

      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`Agent did not respond within ${timeoutMs}ms`)
  }

  describe(`Mock Agent — End-to-End Pipeline`, () => {
    test(`send message → mock agent writes State Protocol response`, async () => {
      const id = `mock-e2e-${Date.now()}`
      const entityUrl = `/chat/${id}`

      await spawnEntity(config.baseUrl, `chat`, id)

      await sendMessage(config.baseUrl, entityUrl, `Say hello`)

      const events = await pollForAgentResponse(config.baseUrl, entityUrl)

      const spEvents = events.filter((e) => e.type && e.key && e.headers)

      expect(spEvents.some((e) => e.type === `run`)).toBe(true)
      expect(spEvents.some((e) => e.type === `step`)).toBe(true)
      expect(spEvents.some((e) => e.type === `text`)).toBe(true)

      checkStateProtocolInvariants(spEvents)

      await killEntity(config.baseUrl, entityUrl)
    }, 15_000)

    test(`mock agent response contains expected text content`, async () => {
      const id = `mock-text-${Date.now()}`
      const entityUrl = `/chat/${id}`

      await spawnEntity(config.baseUrl, `chat`, id)

      await sendMessage(config.baseUrl, entityUrl, `What is 2+2?`)

      const events = await pollForAgentResponse(config.baseUrl, entityUrl)

      const textComplete = events.find(
        (e) =>
          e.type === `text` &&
          (e.headers as Record<string, unknown> | undefined)?.operation ===
            `update`
      )
      expect(textComplete).toBeDefined()
      const value = textComplete!.value as Record<string, unknown>
      expect(value.status).toBe(`completed`)

      await killEntity(config.baseUrl, entityUrl)
    }, 15_000)

    test(`mock agent writes text deltas for streaming`, async () => {
      const id = `mock-deltas-${Date.now()}`
      const entityUrl = `/chat/${id}`

      await spawnEntity(config.baseUrl, `chat`, id)

      await sendMessage(config.baseUrl, entityUrl, `hello`)

      const events = await pollForAgentResponse(config.baseUrl, entityUrl)

      const deltas = events.filter((e) => e.type === `text_delta`)
      expect(deltas.length).toBeGreaterThan(0)

      for (const delta of deltas) {
        const val = delta.value as Record<string, unknown>
        expect(val.delta).toBeDefined()
        expect(typeof val.delta).toBe(`string`)
      }

      await killEntity(config.baseUrl, entityUrl)
    }, 15_000)
  })
}

// ============================================================================
// Mock Agent CLI Tests
// ============================================================================

export interface MockAgentCliTestOptions {
  baseUrl: string
  cliBin: string
}

export function runMockAgentCliTests(config: MockAgentCliTestOptions): void {
  describe(`CLI — Mock Agent End-to-End`, () => {
    test(`spawn → send → agent responds with State Protocol events`, async () => {
      const id = `cli-mock-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`spawn`, `/chat/${id}`)
        .expectExitCode(0)
        .expectStdout(/Spawned/)
        .exec(`send`, `/chat/${id}`, `hello from CLI`)
        .expectExitCode(0)
        .expectStdout(/Message sent/)
        .wait(3000)
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/chat/${id}`)
          expect(res.status, `entity should exist`).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>

          const streams = entity.streams as { main: string }
          const streamRes = await fetch(
            `${baseUrl}${streams.main}?offset=0000000000000000_0000000000000000`
          )
          const events = (await streamRes.json()) as Array<
            Record<string, unknown>
          >

          expect(
            events.some((e) => e.type === `run`),
            `stream should contain run events from agent`
          ).toBe(true)
          expect(
            events.some((e) => e.type === `text`),
            `stream should contain text events from agent`
          ).toBe(true)

          checkStateProtocolInvariants(
            events.filter((e) => e.type && e.key && e.headers)
          )
        })
        .run()
    }, 20_000)

    test(`inspect shows entity after mock agent processes message`, async () => {
      const id = `cli-inspect-mock-${Date.now()}`
      await cliTest(config.baseUrl, config.cliBin)
        .exec(`spawn`, `/chat/${id}`)
        .expectExitCode(0)
        .exec(`send`, `/chat/${id}`, `test message`)
        .expectExitCode(0)
        .wait(3000)
        .exec(`inspect`, `/chat/${id}`)
        .expectExitCode(0)
        .expectStdout(/running|idle/)
        .verifyApi(async (baseUrl) => {
          const res = await fetch(`${baseUrl}/chat/${id}`)
          expect(res.status).toBe(200)
          const entity = (await res.json()) as Record<string, unknown>

          const streams = entity.streams as { main: string }
          const streamRes = await fetch(
            `${baseUrl}${streams.main}?offset=0000000000000000_0000000000000000`
          )
          const events = (await streamRes.json()) as Array<
            Record<string, unknown>
          >

          const hasRunComplete = events.some(
            (e) =>
              e.type === `run` &&
              (e.headers as Record<string, unknown> | undefined)?.operation ===
                `update`
          )
          expect(
            hasRunComplete,
            `mock agent should have written run completion event`
          ).toBe(true)
        })
        .run()
    }, 20_000)
  })
}
