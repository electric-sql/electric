import { describe, expect, it, vi } from 'vitest'
import { internalRouter } from '../src/routing/internal-router'
import type {
  EventSourceContract,
  EventSourceSubscription,
  TenantContext,
} from '../src/index'

describe(`event source subscription routes`, () => {
  it(`creates a manifest-backed webhook wake subscription`, async () => {
    const upsertEventSourceSubscription = vi.fn(
      async (
        _entityUrl: string,
        req: {
          subscription: EventSourceSubscription
          manifest: Record<string, unknown>
        }
      ) => ({
        txid: `tx-1`,
        subscription: req.subscription,
      })
    )
    const ensureEventSourceWakeSource = vi.fn(async () => {})
    const ctx = tenantContext({
      upsertEventSourceSubscription,
      ensureEventSourceWakeSource,
    })

    const response = await internalRouter.fetch(
      new Request(
        `http://agents.test/_electric/entities/coder/session-1/event-source-subscriptions/watch-pr-123`,
        {
          method: `PUT`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            sourceKey: `github-repo`,
            bucketKey: `pull_request`,
            params: { number: 123 },
            lifetime: { kind: `until_entity_stopped` },
            reason: `Watch PR feedback`,
          }),
        }
      ),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toMatchObject({
      txid: `tx-1`,
      subscription: {
        id: `watch-pr-123`,
        entityUrl: `/coder/session-1`,
        sourceKey: `github-repo`,
        sourceUrl: `/_webhooks/github-repo/prs/123`,
        manifestKey: `event-source:watch-pr-123`,
        filterApplied: false,
      },
    })
    expect(ensureEventSourceWakeSource).toHaveBeenCalledWith(
      `/_webhooks/github-repo/prs/123`
    )
    expect(upsertEventSourceSubscription).toHaveBeenCalledWith(
      `/coder/session-1`,
      expect.objectContaining({
        manifest: expect.objectContaining({
          key: `event-source:watch-pr-123`,
          sourceType: `webhook`,
          config: expect.objectContaining({
            endpointKey: `github-repo`,
            streamUrl: `/_webhooks/github-repo/prs/123`,
          }),
        }),
      })
    )
  })

  it(`deletes a pg-sync observation for the entity`, async () => {
    const deletePgSyncObservation = vi.fn(async () => ({ txid: `tx-9` }))
    const ctx = tenantContext({ deletePgSyncObservation })

    const response = await internalRouter.fetch(
      new Request(
        `http://agents.test/_electric/entities/coder/session-1/pg-sync-observations/ref-abc`,
        { method: `DELETE` }
      ),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({ txid: `tx-9` })
    expect(deletePgSyncObservation).toHaveBeenCalledWith(`/coder/session-1`, {
      sourceRef: `ref-abc`,
    })
  })

  it(`lists configured event source contracts`, async () => {
    const ctx = tenantContext()

    const response = await internalRouter.fetch(
      new Request(`http://agents.test/_electric/event-sources`),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({
      eventSources: [githubContract],
    })
  })

  it(`hides disabled and agent-invisible event sources from discovery`, async () => {
    const hiddenContract: EventSourceContract = {
      ...githubContract,
      sourceKey: `hidden-repo`,
      agentVisible: false,
    }
    const disabledContract: EventSourceContract = {
      ...githubContract,
      sourceKey: `disabled-repo`,
      status: `disabled`,
    }
    const ctx = tenantContext({
      eventSources: {
        listEventSources: () => [
          githubContract,
          hiddenContract,
          disabledContract,
        ],
        getEventSource: (sourceKey: string) =>
          [githubContract, hiddenContract, disabledContract].find(
            (source) => source.sourceKey === sourceKey
          ),
      },
    })

    const response = await internalRouter.fetch(
      new Request(`http://agents.test/_electric/event-sources`),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({
      eventSources: [githubContract],
    })
  })

  it(`rejects subscriptions whose params do not match the bucket schema`, async () => {
    const upsertEventSourceSubscription = vi.fn()
    const ensureEventSourceWakeSource = vi.fn(async () => {})
    const ctx = tenantContext({
      upsertEventSourceSubscription,
      ensureEventSourceWakeSource,
    })

    const response = await internalRouter.fetch(
      new Request(
        `http://agents.test/_electric/entities/coder/session-1/event-source-subscriptions/watch-pr-bad`,
        {
          method: `PUT`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            sourceKey: `github-repo`,
            bucketKey: `pull_request`,
            params: { number: `123` },
          }),
        }
      ),
      ctx
    )

    expect(response?.status).toBe(400)
    await expect(response!.json()).resolves.toMatchObject({
      error: {
        message: expect.stringMatching(/paramsSchema.*number/),
      },
    })
    expect(ensureEventSourceWakeSource).not.toHaveBeenCalled()
    expect(upsertEventSourceSubscription).not.toHaveBeenCalled()
  })
})

function tenantContext(
  overrides: {
    upsertEventSourceSubscription?: unknown
    deleteEventSourceSubscription?: unknown
    deletePgSyncObservation?: unknown
    ensureEventSourceWakeSource?: TenantContext[`ensureEventSourceWakeSource`]
    eventSources?: TenantContext[`eventSources`]
  } = {}
): TenantContext {
  const registry = {
    getEntity: vi.fn(async (url: string) =>
      url === `/coder/session-1`
        ? { url, type: `coder`, status: `idle` }
        : undefined
    ),
    getEntityType: vi.fn(),
    hasEntityPermission: vi.fn(async () => true),
  }
  return {
    service: `svc-agent-1`,
    // dev-local is a built-in bypass principal (permissions.ts /
    // isBuiltInSystemPrincipalUrl). These tests assert subscription
    // routing, not authz — and permission enforcement landed on main
    // after they were written, so the registry mocks here don't have
    // the entity-permission methods spawned. Bypass is the minimal fix.
    principal: {
      kind: `system`,
      id: `dev-local`,
      key: `system:dev-local`,
      url: `/principal/system:dev-local`,
    },
    publicUrl: `http://agents.test`,
    durableStreamsUrl: `http://streams.test/v1/stream/svc-agent-1`,
    durableStreamsDispatcher: {} as never,
    pgDb: {} as never,
    entityManager: {
      registry,
      upsertEventSourceSubscription: vi.fn(async () => ({
        txid: `tx-1`,
      })),
      deleteEventSourceSubscription: vi.fn(async () => ({ txid: `tx-1` })),
      deletePgSyncObservation:
        overrides.deletePgSyncObservation ??
        vi.fn(async () => ({ txid: `tx-1` })),
      ...(overrides.upsertEventSourceSubscription
        ? {
            upsertEventSourceSubscription:
              overrides.upsertEventSourceSubscription,
          }
        : {}),
      ...(overrides.deleteEventSourceSubscription
        ? {
            deleteEventSourceSubscription:
              overrides.deleteEventSourceSubscription,
          }
        : {}),
    } as never,
    streamClient: {} as never,
    runtime: {} as never,
    entityBridgeManager: {} as never,
    eventSources: overrides.eventSources ?? {
      listEventSources: () => [githubContract],
      getEventSource: (sourceKey: string) =>
        sourceKey === githubContract.sourceKey ? githubContract : undefined,
    },
    ...(overrides.ensureEventSourceWakeSource
      ? { ensureEventSourceWakeSource: overrides.ensureEventSourceWakeSource }
      : {}),
    isShuttingDown: () => false,
  }
}

const githubContract: EventSourceContract = {
  serviceId: `svc-agent-1`,
  sourceKey: `github-repo`,
  sourceType: `webhook`,
  endpointKey: `github-repo`,
  status: `active`,
  label: `GitHub repository`,
  agentVisible: true,
  revision: 1,
  buckets: [
    {
      key: `pull_request`,
      label: `Pull request`,
      pathTemplate: `prs/:number`,
      paramsSchema: {
        type: `object`,
        required: [`number`],
        properties: { number: { type: `number` } },
      },
    },
  ],
}
