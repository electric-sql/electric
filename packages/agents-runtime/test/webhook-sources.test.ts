import { describe, expect, it } from 'vitest'
import {
  buildWebhookSourceManifestEntry,
  buildHydratedWebhookSourceWake,
  buildWebhookSourceSubscriptionId,
  webhookSourceWakeInfoFromManifests,
  renderWebhookSourceBucketPath,
  resolveWebhookSourceSubscription,
  type WebhookSourceContract,
  type WebhookSourceWakeInfo,
} from '../src/webhook-sources'
import type { WebhookEventRow } from '../src/observation-sources'

describe(`webhook source helpers`, () => {
  it(`renders bucket template paths from params`, () => {
    expect(
      renderWebhookSourceBucketPath(
        {
          key: `pull_request`,
          label: `Pull request`,
          pathTemplate: `prs/:number`,
          paramsSchema: {},
        },
        { number: 123 }
      )
    ).toBe(`prs/123`)
  })

  it(`resolves webhook subscriptions into durable stream manifest entries`, () => {
    const resolved = resolveWebhookSourceSubscription({
      contract: githubContract,
      entityUrl: `/coder/session-1`,
      request: {
        webhookKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        lifetime: { kind: `until_entity_stopped` },
        reason: `Watch PR comments`,
      },
      createdAt: `2026-05-23T00:00:00.000Z`,
    })

    expect(resolved.subscription).toMatchObject({
      entityUrl: `/coder/session-1`,
      webhookKey: `github-repo`,
      bucketKey: `pull_request`,
      sourceUrl: `/_webhooks/github-repo/prs/123`,
      sourceType: `webhook`,
      contractRevision: 7,
      filterApplied: false,
      lifetime: { kind: `until_entity_stopped` },
      reason: `Watch PR comments`,
    })

    expect(buildWebhookSourceManifestEntry(resolved)).toMatchObject({
      key: resolved.subscription.manifestKey,
      kind: `source`,
      sourceType: `webhook`,
      sourceRef: `github-repo/prs/123`,
      config: {
        endpointKey: `github-repo`,
        streamUrl: `/_webhooks/github-repo/prs/123`,
        bucket: `prs/123`,
        webhookSource: {
          webhookKey: `github-repo`,
          bucketKey: `pull_request`,
          params: { number: 123 },
          filterApplied: false,
          contractRevision: 7,
        },
      },
      wake: {
        on: `change`,
        collections: [`webhook_event`],
        ops: [`insert`],
      },
    })
  })

  it(`rejects bucket params that do not match paramsSchema`, () => {
    expect(() =>
      resolveWebhookSourceSubscription({
        contract: githubContract,
        entityUrl: `/coder/session-1`,
        request: {
          webhookKey: `github-repo`,
          bucketKey: `pull_request`,
          params: { number: `123` },
        },
      })
    ).toThrow(/Bucket params do not match paramsSchema.*number/)
  })

  it(`builds deterministic subscription ids`, () => {
    const left = buildWebhookSourceSubscriptionId({
      webhookKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
    })
    const right = buildWebhookSourceSubscriptionId({
      params: { number: 123 },
      bucketKey: `pull_request`,
      webhookKey: `github-repo`,
    })

    expect(left).toBe(right)
  })

  it(`hydrates webhook source wake changes with matching webhook rows`, () => {
    const resolved = resolveWebhookSourceSubscription({
      contract: githubContract,
      entityUrl: `/coder/session-1`,
      request: {
        id: `watch-pr-123`,
        webhookKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        lifetime: { kind: `until_entity_stopped` },
        reason: `Watch PR comments`,
      },
      createdAt: `2026-05-23T00:00:00.000Z`,
    })
    const manifest = buildWebhookSourceManifestEntry(resolved)

    const info = webhookSourceWakeInfoFromManifests({
      manifests: [manifest],
      wakeEvent: {
        type: `wake`,
        source: `/_webhooks/github-repo/prs/123`,
        payload: {
          source: `/_webhooks/github-repo/prs/123`,
          timeout: false,
          changes: [
            {
              collection: `webhook_event`,
              kind: `insert`,
              key: `event-1`,
            },
          ],
        },
      },
    })

    expect(info).toMatchObject({
      sourceUrl: `/_webhooks/github-repo/prs/123`,
      sourceType: `webhook`,
      endpointKey: `github-repo`,
      webhookKey: `github-repo`,
      subscriptionId: `watch-pr-123`,
      bucket: `prs/123`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      reason: `Watch PR comments`,
    })

    const event = webhookEvent({
      key: `event-1`,
      body: {
        comment: {
          body: `Please tell the user a joke when this wakes you up.`,
        },
      },
    })
    const hydrated = buildHydratedWebhookSourceWake(
      info as WebhookSourceWakeInfo,
      [webhookEvent({ key: `event-0` }), event]
    )

    expect(hydrated).toMatchObject({
      type: `webhook_source_wake`,
      source: `/_webhooks/github-repo/prs/123`,
      endpointKey: `github-repo`,
      webhookKey: `github-repo`,
      bucket: `prs/123`,
      subscription: {
        id: `watch-pr-123`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        reason: `Watch PR comments`,
      },
      changes: [
        {
          collection: `webhook_event`,
          kind: `insert`,
          key: `event-1`,
        },
      ],
      events: [event],
    })
  })
})

function webhookEvent(
  overrides: Partial<WebhookEventRow> = {}
): WebhookEventRow {
  return {
    key: `event`,
    body: {},
    event_type: `issue_comment`,
    endpoint_key: `github-repo`,
    bucket: `prs/123`,
    stream_path: `/_webhooks/github-repo/prs/123`,
    headers: {},
    received_at: `2026-05-23T00:00:00.000Z`,
    request: {
      method: `POST`,
      content_type: `application/json`,
      size_bytes: 2,
      query: {},
    },
    ...overrides,
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
  revision: 7,
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
      eventTypes: [`issue_comment`],
    },
  ],
}
