import { describe, expect, it, vi } from 'vitest'
import { internalRouter } from '../src/routing/internal-router'
import type {
  WebhookSourceContract,
  WebhookSourceSubscription,
  TenantContext,
} from '../src/index'

describe(`webhook source subscription routes`, () => {
  it(`creates a manifest-backed webhook wake subscription`, async () => {
    const upsertWebhookSourceSubscription = vi.fn(
      async (
        _entityUrl: string,
        req: {
          subscription: WebhookSourceSubscription
          manifest: Record<string, unknown>
        }
      ) => ({
        txid: `tx-1`,
        subscription: req.subscription,
      })
    )
    const ensureWebhookSourceWakeSource = vi.fn(async () => {})
    const ctx = tenantContext({
      upsertWebhookSourceSubscription,
      ensureWebhookSourceWakeSource,
    })

    const response = await internalRouter.fetch(
      new Request(
        `http://agents.test/_electric/entities/coder/session-1/webhook-source-subscriptions/watch-pr-123`,
        {
          method: `PUT`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            webhookKey: `github-repo`,
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
        webhookKey: `github-repo`,
        sourceUrl: `/_webhooks/github-repo/prs/123`,
        manifestKey: `webhook-source:watch-pr-123`,
        filterApplied: false,
      },
    })
    expect(ensureWebhookSourceWakeSource).toHaveBeenCalledWith(
      `/_webhooks/github-repo/prs/123`
    )
    expect(upsertWebhookSourceSubscription).toHaveBeenCalledWith(
      `/coder/session-1`,
      expect.objectContaining({
        manifest: expect.objectContaining({
          key: `webhook-source:watch-pr-123`,
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

  it(`lists configured webhook source contracts`, async () => {
    const ctx = tenantContext()

    const response = await internalRouter.fetch(
      new Request(`http://agents.test/_electric/webhook-sources`),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({
      webhookSources: [githubContract],
    })
  })

  it(`hides disabled and agent-invisible webhook sources from discovery`, async () => {
    const hiddenContract: WebhookSourceContract = {
      ...githubContract,
      webhookKey: `hidden-repo`,
      agentVisible: false,
    }
    const disabledContract: WebhookSourceContract = {
      ...githubContract,
      webhookKey: `disabled-repo`,
      status: `disabled`,
    }
    const ctx = tenantContext({
      webhookSources: {
        listWebhookSources: () => [
          githubContract,
          hiddenContract,
          disabledContract,
        ],
        getWebhookSource: (webhookKey: string) =>
          [githubContract, hiddenContract, disabledContract].find(
            (source) => source.webhookKey === webhookKey
          ),
      },
    })

    const response = await internalRouter.fetch(
      new Request(`http://agents.test/_electric/webhook-sources`),
      ctx
    )

    expect(response?.status).toBe(200)
    await expect(response!.json()).resolves.toEqual({
      webhookSources: [githubContract],
    })
  })

  it(`rejects subscriptions whose params do not match the bucket schema`, async () => {
    const upsertWebhookSourceSubscription = vi.fn()
    const ensureWebhookSourceWakeSource = vi.fn(async () => {})
    const ctx = tenantContext({
      upsertWebhookSourceSubscription,
      ensureWebhookSourceWakeSource,
    })

    const response = await internalRouter.fetch(
      new Request(
        `http://agents.test/_electric/entities/coder/session-1/webhook-source-subscriptions/watch-pr-bad`,
        {
          method: `PUT`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            webhookKey: `github-repo`,
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
    expect(ensureWebhookSourceWakeSource).not.toHaveBeenCalled()
    expect(upsertWebhookSourceSubscription).not.toHaveBeenCalled()
  })
})

function tenantContext(
  overrides: {
    upsertWebhookSourceSubscription?: unknown
    deleteWebhookSourceSubscription?: unknown
    deletePgSyncObservation?: unknown
    ensureWebhookSourceWakeSource?: TenantContext[`ensureWebhookSourceWakeSource`]
    webhookSources?: TenantContext[`webhookSources`]
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
      upsertWebhookSourceSubscription: vi.fn(async () => ({
        txid: `tx-1`,
      })),
      deleteWebhookSourceSubscription: vi.fn(async () => ({ txid: `tx-1` })),
      deletePgSyncObservation:
        overrides.deletePgSyncObservation ??
        vi.fn(async () => ({ txid: `tx-1` })),
      ...(overrides.upsertWebhookSourceSubscription
        ? {
            upsertWebhookSourceSubscription:
              overrides.upsertWebhookSourceSubscription,
          }
        : {}),
      ...(overrides.deleteWebhookSourceSubscription
        ? {
            deleteWebhookSourceSubscription:
              overrides.deleteWebhookSourceSubscription,
          }
        : {}),
    } as never,
    streamClient: {} as never,
    runtime: {} as never,
    entityBridgeManager: {} as never,
    webhookSources: overrides.webhookSources ?? {
      listWebhookSources: () => [githubContract],
      getWebhookSource: (webhookKey: string) =>
        webhookKey === githubContract.webhookKey ? githubContract : undefined,
    },
    ...(overrides.ensureWebhookSourceWakeSource
      ? {
          ensureWebhookSourceWakeSource:
            overrides.ensureWebhookSourceWakeSource,
        }
      : {}),
    isShuttingDown: () => false,
  }
}

const githubContract: WebhookSourceContract = {
  serviceId: `svc-agent-1`,
  webhookKey: `github-repo`,
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
