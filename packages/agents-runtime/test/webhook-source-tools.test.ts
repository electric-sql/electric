import { describe, expect, it, vi } from 'vitest'
import { createWebhookSourceTools } from '../src/tools/webhook-sources'
import type {
  WebhookSourceContract,
  WebhookSourceSubscription,
} from '../src/webhook-sources'

describe(`webhook source tools`, () => {
  it(`lists discoverable webhook sources`, async () => {
    const tools = createWebhookSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([]),
      listWebhookSources: vi.fn(async () => [githubContract]),
      subscribeToWebhookSource: vi.fn(),
      unsubscribeFromWebhookSource: vi.fn(),
    })

    const result = await executeTool(tools, `list_webhook_sources`, {})

    expect(JSON.parse(result.content[0]!.text)).toEqual([githubContract])
  })

  it(`lists subscriptions from webhook source manifests`, async () => {
    const tools = createWebhookSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([webhookSourceManifest]),
      listWebhookSources: vi.fn(async () => []),
      subscribeToWebhookSource: vi.fn(),
      unsubscribeFromWebhookSource: vi.fn(),
    })

    const result = await executeTool(
      tools,
      `list_webhook_source_subscriptions`,
      {}
    )

    expect(JSON.parse(result.content[0]!.text)).toMatchObject([
      {
        id: `watch-pr-123`,
        entityUrl: `/coder/session-1`,
        webhookKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        sourceUrl: `/_webhooks/github-repo/prs/123`,
      },
    ])
  })

  it(`subscribes and waits for the returned txid`, async () => {
    const awaitTxId = vi.fn(async () => {})
    const subscribeToWebhookSource = vi.fn(async (opts) => ({
      txid: `tx-1`,
      subscription: {
        ...subscription,
        id: opts.id,
        lifetime: opts.lifetime,
      },
    }))
    const tools = createWebhookSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([], awaitTxId),
      listWebhookSources: vi.fn(async () => []),
      subscribeToWebhookSource,
      unsubscribeFromWebhookSource: vi.fn(),
    })

    const result = await executeTool(tools, `subscribe_webhook_source`, {
      webhookKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      reason: `Watch PR feedback`,
    })

    expect(subscribeToWebhookSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^github-repo-pull_request-/),
        webhookKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        lifetime: { kind: `until_entity_stopped` },
        reason: `Watch PR feedback`,
      })
    )
    expect(awaitTxId).toHaveBeenCalledWith(`tx-1`, 10_000)
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      webhookKey: `github-repo`,
      sourceUrl: `/_webhooks/github-repo/prs/123`,
    })
  })

  it(`unsubscribes existing webhook source subscriptions`, async () => {
    const awaitTxId = vi.fn(async () => {})
    const unsubscribeFromWebhookSource = vi.fn(async () => ({ txid: `tx-2` }))
    const tools = createWebhookSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([webhookSourceManifest], awaitTxId),
      listWebhookSources: vi.fn(async () => []),
      subscribeToWebhookSource: vi.fn(),
      unsubscribeFromWebhookSource,
    })

    const result = await executeTool(tools, `unsubscribe_webhook_source`, {
      id: `watch-pr-123`,
    })

    expect(unsubscribeFromWebhookSource).toHaveBeenCalledWith({
      id: `watch-pr-123`,
    })
    expect(awaitTxId).toHaveBeenCalledWith(`tx-2`, 10_000)
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      deleted: true,
      id: `watch-pr-123`,
      key: `webhook-source:watch-pr-123`,
    })
  })
})

function dbWithManifests(
  manifests: Array<Record<string, unknown>>,
  awaitTxId = vi.fn(async () => {})
) {
  return {
    collections: {
      manifests: {
        toArray: manifests,
      },
    },
    utils: {
      awaitTxId,
    },
  } as any
}

async function executeTool(
  tools: ReturnType<typeof createWebhookSourceTools>,
  name: string,
  params: Record<string, unknown>
) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  return await (tool.execute as any)(`call-1`, params)
}

const githubContract: WebhookSourceContract = {
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

const subscription: WebhookSourceSubscription = {
  id: `watch-pr-123`,
  entityUrl: `/coder/session-1`,
  webhookKey: `github-repo`,
  bucketKey: `pull_request`,
  params: { number: 123 },
  filterApplied: false,
  contractRevision: 1,
  sourceUrl: `/_webhooks/github-repo/prs/123`,
  sourceType: `webhook`,
  manifestKey: `webhook-source:watch-pr-123`,
  lifetime: { kind: `until_entity_stopped` },
  reason: `Watch PR feedback`,
  createdBy: `tool`,
  createdAt: `2026-05-23T00:00:00.000Z`,
}

const webhookSourceManifest = {
  key: `webhook-source:watch-pr-123`,
  kind: `source`,
  sourceType: `webhook`,
  sourceRef: `github-repo/prs/123`,
  config: {
    endpointKey: `github-repo`,
    streamUrl: `/_webhooks/github-repo/prs/123`,
    bucket: `prs/123`,
    webhookSource: {
      id: `watch-pr-123`,
      webhookKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      filterApplied: false,
      contractRevision: 1,
      lifetime: { kind: `until_entity_stopped` },
      reason: `Watch PR feedback`,
      createdBy: `tool`,
      createdAt: `2026-05-23T00:00:00.000Z`,
    },
  },
  wake: {
    on: `change`,
    collections: [`webhook_event`],
    ops: [`insert`],
  },
}
