import { describe, expect, it, vi } from 'vitest'
import { ClaimWriteTokenStore } from '../src/claim-write-token-store'
import { globalRouter } from '../src/routing/global-router'
import type { TenantContext } from '../src/routing/context'
import type { DurableStreamsRoutingAdapter } from '../src/routing/durable-streams-routing-adapter'

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://agents.local${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function responseJson(response: Response): Promise<any> {
  return response.json()
}

function requestBodyJson(body: BodyInit | null | undefined): any {
  if (body instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(body)))
  }
  if (ArrayBuffer.isView(body)) {
    return JSON.parse(new TextDecoder().decode(body as Uint8Array))
  }
  return JSON.parse(String(body ?? `{}`))
}

function selectDb(rows: Array<Record<string, unknown>>) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return { select, from, where, limit }
}

function insertDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined)
  const values = vi.fn(() => ({ onConflictDoUpdate }))
  const insert = vi.fn(() => ({ values }))
  return { insert, values, onConflictDoUpdate }
}

const serviceRoutedTestAdapter: DurableStreamsRoutingAdapter = {
  streamUrl(input) {
    const incomingUrl = new URL(input.requestUrl, `http://localhost`)
    const path = incomingUrl.pathname.replace(/^\/+/, ``)
    const target = new URL(
      `/v1/streams/${input.serviceId}/${path}`,
      input.durableStreamsUrl
    )
    target.search = incomingUrl.search
    return target
  },
  controlUrl(input) {
    const incomingUrl = new URL(input.requestUrl, `http://localhost`)
    const target = new URL(
      `/v1/streams/${input.serviceId}${incomingUrl.pathname}`,
      input.durableStreamsUrl
    )
    target.search = incomingUrl.search
    return target
  },
  toBackendStreamPath(_serviceId, streamPath) {
    return streamPath.replace(/^\/+/, ``)
  },
  toRuntimeStreamPath(_serviceId, streamPath) {
    return streamPath.replace(/^\/+/, ``)
  },
}

function buildContext(overrides: Partial<TenantContext> = {}): TenantContext {
  const entity = {
    url: `/horton/demo`,
    type: `horton`,
    status: `idle`,
    streams: {
      main: `/horton/demo/main`,
      error: `/horton/demo/error`,
    },
    tags: {},
    spawn_args: {},
    write_token: `write-token`,
  }

  return {
    service: `tenant-a`,
    principal: {
      kind: `system`,
      id: `framework`,
      key: `system:framework`,
      url: `/principal/system:framework`,
    },
    publicUrl: `http://agents.local`,
    durableStreamsUrl: `http://durable.local/v1/stream/tenant-a`,
    durableStreamsDispatcher: undefined as any,
    pgDb: undefined as any,
    entityManager: {
      registry: {
        getEntityByStream: vi.fn().mockResolvedValue(entity),
        updateStatus: vi.fn().mockResolvedValue(undefined),
        materializeReleasedClaim: vi.fn().mockResolvedValue({
          claim: null,
          entityCleared: true,
        }),
        materializeHeartbeatClaim: vi.fn().mockResolvedValue(undefined),
      },
      enrichPayload: vi.fn(async (payload: Record<string, unknown>) => ({
        ...payload,
        entity: {
          type: entity.type,
          status: entity.status,
          url: entity.url,
          streams: entity.streams,
          tags: entity.tags,
          spawnArgs: entity.spawn_args,
        },
        triggerEvent: `message_received`,
      })),
      isForkWorkLockedEntity: vi.fn(() => false),
    } as any,
    streamClient: undefined as any,
    runtime: { claimWriteTokens: new ClaimWriteTokenStore() } as any,
    entityBridgeManager: {
      onEntityChanged: vi.fn().mockResolvedValue(undefined),
    } as any,
    isShuttingDown: () => false,
    ...overrides,
  }
}

describe(`webhook forwarding for Durable Streams subscriptions`, () => {
  it(`adapts the new webhook wake payload into the runtime wake payload`, async () => {
    const select = selectDb([
      { webhookUrl: `http://runtime.local/_electric/builtin-agent-handler` },
    ])
    const insert = insertDb()
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      const response = await globalRouter.fetch(
        request(`POST`, `/_electric/webhook-forward/horton-handler`, {
          subscription_id: `horton-handler`,
          wake_id: `wake-1`,
          generation: 7,
          streams: [
            {
              path: `horton/demo/main`,
              acked_offset: `0`,
              tail_offset: `1`,
              has_pending: true,
            },
          ],
          callback_url: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
          callback_token: `callback-token`,
        }),
        buildContext({
          pgDb: { select: select.select, insert: insert.insert } as any,
        })
      )

      expect(response.status).toBe(200)
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://runtime.local/_electric/builtin-agent-handler`
      )
      expect(requestBodyJson(init?.body)).toMatchObject({
        consumerId: `wake-1`,
        epoch: 7,
        wakeId: `wake-1`,
        streamPath: `/horton/demo/main`,
        streams: [{ path: `/horton/demo/main`, offset: `1` }],
        callback: `http://agents.local/_electric/callback-forward/wake-1`,
        claimToken: `callback-token`,
        entity: {
          type: `horton`,
          url: `/horton/demo`,
        },
      })
      expect(insert.values).toHaveBeenCalledWith({
        tenantId: `tenant-a`,
        consumerId: `wake-1`,
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/demo/main`,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`routes new webhook wakes to the pending stream when DS includes stale streams first`, async () => {
    const select = selectDb([
      { webhookUrl: `http://runtime.local/_electric/builtin-agent-handler` },
    ])
    const insert = insertDb()
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const pendingEntity = {
      url: `/horton/pending`,
      type: `horton`,
      status: `idle`,
      streams: {
        main: `/horton/pending/main`,
        error: `/horton/pending/error`,
      },
      tags: {},
      spawn_args: {},
      write_token: `pending-write-token`,
    }
    const getEntityByStream = vi.fn(async (stream: string) =>
      stream === `/horton/pending/main` ? pendingEntity : undefined
    )

    try {
      const response = await globalRouter.fetch(
        request(`POST`, `/_electric/webhook-forward/horton-handler`, {
          subscription_id: `horton-handler`,
          wake_id: `wake-2`,
          generation: 8,
          streams: [
            {
              path: `horton/old/main`,
              acked_offset: `10`,
              tail_offset: `10`,
              has_pending: false,
            },
            {
              path: `horton/pending/main`,
              acked_offset: `0`,
              tail_offset: `1`,
              has_pending: true,
            },
          ],
          callback_url: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
          callback_token: `callback-token`,
        }),
        buildContext({
          pgDb: { select: select.select, insert: insert.insert } as any,
          entityManager: {
            registry: {
              getEntityByStream,
              updateStatus: vi.fn().mockResolvedValue(undefined),
            },
            enrichPayload: vi.fn(async (payload: Record<string, unknown>) => ({
              ...payload,
              entity: {
                type: pendingEntity.type,
                status: pendingEntity.status,
                url: pendingEntity.url,
                streams: pendingEntity.streams,
                tags: pendingEntity.tags,
                spawnArgs: pendingEntity.spawn_args,
              },
              triggerEvent: `message_received`,
            })),
            isForkWorkLockedEntity: vi.fn(() => false),
          } as any,
        })
      )

      expect(response.status).toBe(200)
      expect(getEntityByStream).toHaveBeenCalledWith(`/horton/pending/main`)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(requestBodyJson(init?.body)).toMatchObject({
        streamPath: `/horton/pending/main`,
        streams: [{ path: `/horton/pending/main`, offset: `1` }],
        entity: {
          url: `/horton/pending`,
        },
      })
      expect(insert.values).toHaveBeenCalledWith({
        tenantId: `tenant-a`,
        consumerId: `wake-2`,
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/pending/main`,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`keeps root-relative DS wake stream paths before forwarding to the runtime`, async () => {
    const select = selectDb([
      { webhookUrl: `http://runtime.local/_electric/builtin-agent-handler` },
    ])
    const insert = insertDb()
    const getEntityByStream = vi.fn().mockResolvedValue({
      url: `/horton/demo`,
      type: `horton`,
      status: `idle`,
      streams: {
        main: `/horton/demo/main`,
        error: `/horton/demo/error`,
      },
      tags: {},
      spawn_args: {},
      write_token: `write-token`,
    })
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      const response = await globalRouter.fetch(
        request(`POST`, `/_electric/webhook-forward/horton-handler`, {
          subscription_id: `horton-handler`,
          wake_id: `wake-prefixed`,
          generation: 9,
          streams: [
            {
              path: `horton/demo/main`,
              acked_offset: `0`,
              tail_offset: `1`,
              has_pending: true,
            },
          ],
          callback_url: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
          callback_token: `callback-token`,
        }),
        buildContext({
          pgDb: { select: select.select, insert: insert.insert } as any,
          entityManager: {
            registry: {
              getEntityByStream,
              updateStatus: vi.fn().mockResolvedValue(undefined),
            },
            enrichPayload: vi.fn(async (payload: Record<string, unknown>) => ({
              ...payload,
              entity: {
                type: `horton`,
                status: `idle`,
                url: `/horton/demo`,
                streams: {
                  main: `/horton/demo/main`,
                  error: `/horton/demo/error`,
                },
                tags: {},
                spawnArgs: {},
              },
              triggerEvent: `message_received`,
            })),
            isForkWorkLockedEntity: vi.fn(() => false),
          } as any,
        })
      )

      expect(response.status).toBe(200)
      expect(getEntityByStream).toHaveBeenCalledWith(`/horton/demo/main`)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(requestBodyJson(init?.body)).toMatchObject({
        streamPath: `/horton/demo/main`,
        streams: [{ path: `/horton/demo/main`, offset: `1` }],
      })
      expect(insert.values).toHaveBeenCalledWith({
        tenantId: `tenant-a`,
        consumerId: `wake-prefixed`,
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/demo/main`,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`claims new webhook wakes locally and returns a tenant-scoped claim write token`, async () => {
    const select = selectDb([
      {
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/demo/main`,
      },
    ])
    const fetchSpy = vi.spyOn(globalThis, `fetch`)

    const ctx = buildContext({
      pgDb: { select: select.select } as any,
    })

    try {
      const response = await globalRouter.fetch(
        request(`POST`, `/_electric/callback-forward/wake-1`, {
          wakeId: `wake-1`,
          epoch: 7,
        }),
        ctx
      )

      expect(response.status).toBe(200)
      const body = await responseJson(response)
      expect(body.ok).toBe(true)
      expect(body.writeToken).toEqual(expect.any(String))
      expect(body.writeToken).not.toBe(`write-token`)
      expect(
        ctx.runtime.claimWriteTokens.isValid(
          `tenant-a`,
          `/horton/demo/main`,
          body.writeToken
        )
      ).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`auto-acks webhook wakes for stopped entities`, async () => {
    const select = selectDb([
      { webhookUrl: `http://runtime.local/_electric/builtin-agent-handler` },
    ])
    const insert = insertDb()
    const stoppedEntity = {
      url: `/horton/demo`,
      type: `horton`,
      status: `stopped`,
      streams: {
        main: `/horton/demo/main`,
        error: `/horton/demo/error`,
      },
    }
    const fetchSpy = vi.spyOn(globalThis, `fetch`)

    try {
      const response = await globalRouter.fetch(
        request(`POST`, `/_electric/webhook-forward/horton-handler`, {
          subscription_id: `horton-handler`,
          wake_id: `wake-stopped`,
          generation: 8,
          streams: [
            {
              path: `horton/demo/main`,
              acked_offset: `1`,
              tail_offset: `2`,
              has_pending: true,
            },
          ],
          callback_url: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
          callback_token: `callback-token`,
        }),
        buildContext({
          pgDb: { select: select.select, insert: insert.insert } as any,
          entityManager: {
            registry: {
              getEntityByStream: vi.fn().mockResolvedValue(stoppedEntity),
              updateStatus: vi.fn().mockResolvedValue(undefined),
            },
            enrichPayload: vi.fn(async (payload) => payload),
            isForkWorkLockedEntity: vi.fn(() => false),
          } as any,
        })
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ done: true })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`translates runtime done callbacks to the new Durable Streams callback shape`, async () => {
    const select = selectDb([
      {
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/demo/main`,
      },
    ])
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, next_wake: false }), {
        headers: { 'content-type': `application/json` },
      })
    )
    const ctx = buildContext({
      pgDb: { select: select.select } as any,
    })
    const claimToken = ctx.runtime.claimWriteTokens.mint(
      `tenant-a`,
      `/horton/demo/main`,
      `wake-1`
    )

    try {
      const response = await globalRouter.fetch(
        new Request(`http://agents.local/_electric/callback-forward/wake-1`, {
          method: `POST`,
          headers: {
            'content-type': `application/json`,
            authorization: `Bearer callback-token`,
          },
          body: JSON.stringify({
            epoch: 7,
            acks: [{ path: `/horton/demo/main`, offset: `1` }],
            done: true,
          }),
        }),
        ctx
      )

      expect(response.status).toBe(200)
      const [url, init] = fetchSpy.mock.calls[0]!
      expect(String(url)).toBe(
        `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`
      )
      expect(init).toMatchObject({
        method: `POST`,
      })
      expect((init?.headers as Headers).get(`authorization`)).toBe(
        `Bearer callback-token`
      )
      expect(requestBodyJson(init?.body)).toEqual({
        wake_id: `wake-1`,
        generation: 7,
        acks: [{ stream: `horton/demo/main`, offset: `1` }],
        done: true,
      })
      expect(ctx.entityManager.registry.updateStatus).toHaveBeenCalledWith(
        `/horton/demo`,
        `idle`
      )
      expect(ctx.entityBridgeManager.onEntityChanged).toHaveBeenCalledWith(
        `/horton/demo`
      )
      expect(
        ctx.runtime.claimWriteTokens.isValid(
          `tenant-a`,
          `/horton/demo/main`,
          claimToken
        )
      ).toBe(false)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`lets a routing adapter own callback ack stream paths`, async () => {
    const select = selectDb([
      {
        callbackUrl: `http://durable.local/v1/stream/tenant-a/__ds/subscriptions/horton-handler/callback`,
        primaryStream: `/horton/demo/main`,
      },
    ])
    const fetchSpy = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, next_wake: false }), {
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      const response = await globalRouter.fetch(
        new Request(`http://agents.local/_electric/callback-forward/wake-1`, {
          method: `POST`,
          headers: {
            'content-type': `application/json`,
            authorization: `Bearer callback-token`,
          },
          body: JSON.stringify({
            epoch: 7,
            acks: [{ path: `/horton/demo/main`, offset: `1` }],
            done: true,
          }),
        }),
        buildContext({
          durableStreamsRouting: serviceRoutedTestAdapter,
          pgDb: { select: select.select } as any,
        })
      )

      expect(response.status).toBe(200)
      const [, init] = fetchSpy.mock.calls[0]!
      expect(requestBodyJson(init?.body)).toEqual({
        wake_id: `wake-1`,
        generation: 7,
        acks: [{ stream: `horton/demo/main`, offset: `1` }],
        done: true,
      })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  describe(`claim release on done callback (regression for #4340)`, () => {
    const upstreamOk = (): void => {
      vi.spyOn(globalThis, `fetch`).mockResolvedValue(
        new Response(JSON.stringify({ ok: true, next_wake: false }), {
          headers: { 'content-type': `application/json` },
        })
      )
    }

    it(`marks the consumer_claims row released and the entity idle on done`, async () => {
      const select = selectDb([
        {
          callbackUrl: `http://durable.local/v1/stream-meta/subscriptions/horton-handler/callback?service=tenant-a`,
          primaryStream: `/horton/demo/main`,
        },
      ])
      upstreamOk()
      const ctx = buildContext({
        pgDb: { select: select.select } as any,
      })
      // Simulate the runtime's claim phase having minted a token.
      ctx.runtime.claimWriteTokens.mint(
        `tenant-a`,
        `/horton/demo/main`,
        `wake-1`
      )

      try {
        const response = await globalRouter.fetch(
          new Request(`http://agents.local/_electric/callback-forward/wake-1`, {
            method: `POST`,
            headers: {
              'content-type': `application/json`,
              authorization: `Bearer callback-token`,
            },
            body: JSON.stringify({
              epoch: 7,
              acks: [{ path: `/horton/demo/main`, offset: `1` }],
              done: true,
            }),
          }),
          ctx
        )

        expect(response.status).toBe(200)
        expect(
          ctx.entityManager.registry.materializeReleasedClaim
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            consumerId: `wake-1`,
            epoch: 7,
            ackedStreams: [{ path: `/horton/demo/main`, offset: `1` }],
          })
        )
        expect(ctx.entityManager.registry.updateStatus).toHaveBeenCalledWith(
          `/horton/demo`,
          `idle`
        )
      } finally {
        vi.mocked(globalThis.fetch).mockRestore()
      }
    })

    it(`still releases the consumer_claims row when the in-memory write token is missing (e.g. server restart)`, async () => {
      // Reproduces the production failure mode where the in-memory
      // ClaimWriteTokenStore is empty (server restarted between dispatch and
      // done, or another wake evicted the token) but the consumer_claims row
      // is still active in the DB. Today the release path skips
      // materializeReleasedClaim under this condition and the row leaks.
      const select = selectDb([
        {
          callbackUrl: `http://durable.local/v1/stream-meta/subscriptions/horton-handler/callback?service=tenant-a`,
          primaryStream: `/horton/demo/main`,
        },
      ])
      upstreamOk()
      const ctx = buildContext({
        pgDb: { select: select.select } as any,
      })
      // Intentionally do NOT mint a write token — simulates the token
      // being lost between the runtime's claim phase and its done call.

      try {
        const response = await globalRouter.fetch(
          new Request(`http://agents.local/_electric/callback-forward/wake-1`, {
            method: `POST`,
            headers: {
              'content-type': `application/json`,
              authorization: `Bearer callback-token`,
            },
            body: JSON.stringify({
              epoch: 7,
              acks: [{ path: `/horton/demo/main`, offset: `1` }],
              done: true,
            }),
          }),
          ctx
        )

        expect(response.status).toBe(200)
        // The DB row identity (consumerId, epoch) is sufficient to release
        // the claim — release must not depend on in-memory write-token state.
        expect(
          ctx.entityManager.registry.materializeReleasedClaim
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            consumerId: `wake-1`,
            epoch: 7,
          })
        )
        // The entity should transition back to idle so the UI no longer
        // shows it as "running" after the agent finishes.
        expect(ctx.entityManager.registry.updateStatus).toHaveBeenCalledWith(
          `/horton/demo`,
          `idle`
        )
      } finally {
        vi.mocked(globalThis.fetch).mockRestore()
      }
    })

    it(`releases an earlier wake's claim even after a later wake evicted its in-memory token`, async () => {
      // Same defect, different cause: two wakes for the same entity arrive
      // close together. The second's mint evicts the first's token. The
      // first wake's done call then finds stillOwnsClaim=false and skips
      // the release.
      const select = selectDb([
        {
          callbackUrl: `http://durable.local/v1/stream-meta/subscriptions/horton-handler/callback?service=tenant-a`,
          primaryStream: `/horton/demo/main`,
        },
      ])
      upstreamOk()
      const ctx = buildContext({
        pgDb: { select: select.select } as any,
      })
      // Simulate the DB state where consumer-old's row is still active but
      // entityDispatchState's active claim is consumer-new (the later wake).
      ;(
        ctx.entityManager.registry.materializeReleasedClaim as any
      ).mockResolvedValue({ claim: null, entityCleared: false })

      ctx.runtime.claimWriteTokens.mint(
        `tenant-a`,
        `/horton/demo/main`,
        `wake-1`
      )
      // A second wake arrives and re-mints for the same stream, evicting
      // wake-1 from the in-memory store.
      ctx.runtime.claimWriteTokens.mint(
        `tenant-a`,
        `/horton/demo/main`,
        `wake-2`
      )

      try {
        await globalRouter.fetch(
          new Request(`http://agents.local/_electric/callback-forward/wake-1`, {
            method: `POST`,
            headers: {
              'content-type': `application/json`,
              authorization: `Bearer callback-token`,
            },
            body: JSON.stringify({
              epoch: 7,
              acks: [{ path: `/horton/demo/main`, offset: `1` }],
              done: true,
            }),
          }),
          ctx
        )

        // The DB row for wake-1 must still be released.
        expect(
          ctx.entityManager.registry.materializeReleasedClaim
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            consumerId: `wake-1`,
            epoch: 7,
          })
        )
        // But the entity status must NOT be set to idle — wake-2 is still
        // in flight and owns the entity's active dispatch.
        expect(ctx.entityManager.registry.updateStatus).not.toHaveBeenCalled()
      } finally {
        vi.mocked(globalThis.fetch).mockRestore()
      }
    })
  })
})
