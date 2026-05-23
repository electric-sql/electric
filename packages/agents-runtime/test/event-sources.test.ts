import { describe, expect, it } from 'vitest'
import {
  buildEventSourceManifestEntry,
  buildEventSourceSubscriptionId,
  renderEventSourceBucketPath,
  resolveEventSourceSubscription,
  type EventSourceContract,
} from '../src/event-sources'

describe(`event source helpers`, () => {
  it(`renders bucket template paths from params`, () => {
    expect(
      renderEventSourceBucketPath(
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
    const resolved = resolveEventSourceSubscription({
      contract: githubContract,
      entityUrl: `/coder/session-1`,
      request: {
        sourceKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        lifetime: { kind: `until_entity_stopped` },
        reason: `Watch PR comments`,
      },
      createdAt: `2026-05-23T00:00:00.000Z`,
    })

    expect(resolved.subscription).toMatchObject({
      entityUrl: `/coder/session-1`,
      sourceKey: `github-repo`,
      bucketKey: `pull_request`,
      sourceUrl: `/_webhooks/github-repo/prs/123`,
      sourceType: `webhook`,
      contractRevision: 7,
      filterApplied: false,
      lifetime: { kind: `until_entity_stopped` },
      reason: `Watch PR comments`,
    })

    expect(buildEventSourceManifestEntry(resolved)).toMatchObject({
      key: resolved.subscription.manifestKey,
      kind: `source`,
      sourceType: `webhook`,
      sourceRef: `github-repo/prs/123`,
      config: {
        endpointKey: `github-repo`,
        streamUrl: `/_webhooks/github-repo/prs/123`,
        bucket: `prs/123`,
        eventSource: {
          sourceKey: `github-repo`,
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

  it(`builds deterministic subscription ids`, () => {
    const left = buildEventSourceSubscriptionId({
      sourceKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
    })
    const right = buildEventSourceSubscriptionId({
      params: { number: 123 },
      bucketKey: `pull_request`,
      sourceKey: `github-repo`,
    })

    expect(left).toBe(right)
  })
})

const githubContract: EventSourceContract = {
  serviceId: `svc-agent-1`,
  sourceKey: `github-repo`,
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
