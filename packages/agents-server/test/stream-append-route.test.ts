import { describe, expect, it, vi } from 'vitest'
import { EntityManager } from '../src/entity-manager'
import { SchemaValidator } from '../src/electric-agents/schema-validator'
import {
  createStreamAppendRouteRequest,
  electricAgentsStreamAppendRouter,
} from '../src/routing/stream-append'
import type {
  DurableStreamsAppendForwarder,
  ElectricAgentsStreamAppendRuntime,
} from '../src/routing/stream-append'

const observedItemSchema = {
  type: `object`,
  properties: {
    key: { type: `string` },
    value: { type: `string` },
  },
  required: [`key`, `value`],
}

const coderType = {
  name: `coder`,
  state_schemas: { observed_item: observedItemSchema },
}

const coderEntity = {
  url: `/coder/session-1`,
  type: `coder`,
  status: `running`,
  write_token: `token-1`,
  streams: { main: `/coder/session-1/main` },
}

function createRuntime(entity: Record<string, unknown> = coderEntity) {
  const registry = {
    getEntityByStream: vi.fn().mockResolvedValue(entity),
    getEntityType: vi.fn().mockResolvedValue(coderType),
    close: vi.fn(),
  }
  const runtime: ElectricAgentsStreamAppendRuntime = {
    manager: new EntityManager({
      registry: registry as any,
      streamClient: {} as any,
      validator: new SchemaValidator(),
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    }),
    evaluateWakePayload: vi.fn(async () => {}),
    checkRunFinished: vi.fn(),
    syncManifestWakes: vi.fn(async () => {}),
    syncManifestEntitySources: vi.fn(async () => {}),
    syncManifestSchedules: vi.fn(async () => {}),
  }
  const forward: DurableStreamsAppendForwarder = vi.fn(
    async () => new Response(null, { status: 200 })
  )
  return { registry, runtime, forward }
}

function appendEvents(
  runtime: ElectricAgentsStreamAppendRuntime,
  forward: DurableStreamsAppendForwarder,
  events: Array<Record<string, unknown>>
) {
  return electricAgentsStreamAppendRouter.fetch(
    createStreamAppendRouteRequest(
      new Request(`http://agents.test/coder/session-1/main`, {
        method: `POST`,
        headers: {
          authorization: `Bearer token-1`,
          'content-type': `application/json`,
        },
        body: JSON.stringify(events),
      })
    ),
    runtime,
    forward
  )
}

function observedItem(index: number): Record<string, unknown> {
  return {
    type: `observed_item`,
    key: `item-${index}`,
    headers: { operation: `insert` },
    value: { key: `item-${index}`, value: `value-${index}` },
  }
}

describe(`stream append route`, () => {
  it(`resolves the entity type once for a multi-event append`, async () => {
    const { registry, runtime, forward } = createRuntime()
    const events = Array.from({ length: 10 }, (_, index) => observedItem(index))

    const response = await appendEvents(runtime, forward, events)

    expect(response?.status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(registry.getEntityByStream).toHaveBeenCalledTimes(1)
    expect(registry.getEntityType).toHaveBeenCalledTimes(1)
  })

  it(`rejects the first invalid event in order without forwarding`, async () => {
    const { runtime, forward } = createRuntime()

    const response = await appendEvents(runtime, forward, [
      observedItem(0),
      { type: `unknown_item`, value: { key: `item-1`, value: `beta` } },
      { type: `observed_item`, value: { key: `item-2` } },
    ])

    expect(response?.status).toBe(422)
    await expect(response!.json()).resolves.toEqual({
      error: {
        code: `UNKNOWN_EVENT_TYPE`,
        message: `Unknown event type "unknown_item"`,
      },
    })
    expect(forward).not.toHaveBeenCalled()
  })

  it(`reports a schema failure at its position in the batch`, async () => {
    const { runtime, forward } = createRuntime()

    const response = await appendEvents(runtime, forward, [
      observedItem(0),
      observedItem(1),
      { type: `observed_item`, value: { key: `item-2` } },
    ])

    expect(response?.status).toBe(422)
    await expect(response!.json()).resolves.toMatchObject({
      error: { code: `SCHEMA_VALIDATION_FAILED` },
    })
    expect(forward).not.toHaveBeenCalled()
  })

  it(`skips validation for an untyped entity`, async () => {
    const { type: _type, ...untypedEntity } = coderEntity
    const { registry, runtime, forward } = createRuntime(untypedEntity)

    const response = await appendEvents(runtime, forward, [
      { type: `anything`, value: { free: `form` } },
    ])

    expect(response?.status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(1)
    expect(registry.getEntityType).not.toHaveBeenCalled()
  })

  it(`validates every event of an append against one schema snapshot`, async () => {
    const { registry, runtime, forward } = createRuntime()
    registry.getEntityType
      .mockResolvedValueOnce(coderType)
      .mockResolvedValueOnce({
        name: `coder`,
        state_schemas: { renamed_item: observedItemSchema },
      })

    const response = await appendEvents(runtime, forward, [
      observedItem(0),
      observedItem(1),
    ])

    expect(response?.status).toBe(200)
    expect(forward).toHaveBeenCalledTimes(1)
  })
})
