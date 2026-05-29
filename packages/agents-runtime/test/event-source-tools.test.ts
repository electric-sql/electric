import { describe, expect, it, vi } from 'vitest'
import { createEventSourceTools } from '../src/tools/event-sources'
import type {
  EventSourceContract,
  EventSourceSubscription,
} from '../src/event-sources'

describe(`event source tools`, () => {
  it(`lists discoverable event sources`, async () => {
    const tools = createEventSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([]),
      listEventSources: vi.fn(async () => [githubContract]),
      subscribeToEventSource: vi.fn(),
      unsubscribeFromEventSource: vi.fn(),
    })

    const result = await executeTool(tools, `list_event_sources`, {})

    expect(JSON.parse(result.content[0]!.text)).toEqual([githubContract])
  })

  it(`lists subscriptions from webhook source manifests`, async () => {
    const tools = createEventSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([eventSourceManifest]),
      listEventSources: vi.fn(async () => []),
      subscribeToEventSource: vi.fn(),
      unsubscribeFromEventSource: vi.fn(),
    })

    const result = await executeTool(
      tools,
      `list_event_source_subscriptions`,
      {}
    )

    expect(JSON.parse(result.content[0]!.text)).toMatchObject([
      {
        id: `watch-pr-123`,
        entityUrl: `/coder/session-1`,
        sourceKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        sourceUrl: `/_webhooks/github-repo/prs/123`,
      },
    ])
  })

  it(`subscribes and waits for the returned txid`, async () => {
    const awaitTxId = vi.fn(async () => {})
    const subscribeToEventSource = vi.fn(async (opts) => ({
      txid: `tx-1`,
      subscription: {
        ...subscription,
        id: opts.id,
        lifetime: opts.lifetime,
      },
    }))
    const tools = createEventSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([], awaitTxId),
      listEventSources: vi.fn(async () => []),
      subscribeToEventSource,
      unsubscribeFromEventSource: vi.fn(),
    })

    const result = await executeTool(tools, `subscribe_event_source`, {
      sourceKey: `github-repo`,
      bucketKey: `pull_request`,
      params: { number: 123 },
      reason: `Watch PR feedback`,
    })

    expect(subscribeToEventSource).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^github-repo-pull_request-/),
        sourceKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        lifetime: { kind: `until_entity_stopped` },
        reason: `Watch PR feedback`,
      })
    )
    expect(awaitTxId).toHaveBeenCalledWith(`tx-1`, 10_000)
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      sourceKey: `github-repo`,
      sourceUrl: `/_webhooks/github-repo/prs/123`,
    })
  })

  it(`unsubscribes existing event source subscriptions`, async () => {
    const awaitTxId = vi.fn(async () => {})
    const unsubscribeFromEventSource = vi.fn(async () => ({ txid: `tx-2` }))
    const tools = createEventSourceTools({
      entityUrl: `/coder/session-1`,
      db: dbWithManifests([eventSourceManifest], awaitTxId),
      listEventSources: vi.fn(async () => []),
      subscribeToEventSource: vi.fn(),
      unsubscribeFromEventSource,
    })

    const result = await executeTool(tools, `unsubscribe_event_source`, {
      id: `watch-pr-123`,
    })

    expect(unsubscribeFromEventSource).toHaveBeenCalledWith({
      id: `watch-pr-123`,
    })
    expect(awaitTxId).toHaveBeenCalledWith(`tx-2`, 10_000)
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      deleted: true,
      id: `watch-pr-123`,
      key: `event-source:watch-pr-123`,
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
  tools: ReturnType<typeof createEventSourceTools>,
  name: string,
  params: Record<string, unknown>
) {
  const tool = tools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`Missing tool: ${name}`)
  return await (tool.execute as any)(`call-1`, params)
}

const githubContract: EventSourceContract = {
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

const subscription: EventSourceSubscription = {
  id: `watch-pr-123`,
  entityUrl: `/coder/session-1`,
  sourceKey: `github-repo`,
  bucketKey: `pull_request`,
  params: { number: 123 },
  filterApplied: false,
  contractRevision: 1,
  sourceUrl: `/_webhooks/github-repo/prs/123`,
  sourceType: `webhook`,
  manifestKey: `event-source:watch-pr-123`,
  lifetime: { kind: `until_entity_stopped` },
  reason: `Watch PR feedback`,
  createdBy: `tool`,
  createdAt: `2026-05-23T00:00:00.000Z`,
}

const eventSourceManifest = {
  key: `event-source:watch-pr-123`,
  kind: `source`,
  sourceType: `webhook`,
  sourceRef: `github-repo/prs/123`,
  config: {
    endpointKey: `github-repo`,
    streamUrl: `/_webhooks/github-repo/prs/123`,
    bucket: `prs/123`,
    eventSource: {
      id: `watch-pr-123`,
      sourceKey: `github-repo`,
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
