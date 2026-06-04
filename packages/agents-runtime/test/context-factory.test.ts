import { describe, expect, it, vi } from 'vitest'
import { getCronStreamPath } from '../src/cron-utils'
import { createHandlerContext } from '../src/context-factory'
import { ENTITY_COLLECTIONS } from '../src/entity-schema'
import { createLocalOnlyTestCollection } from './helpers/local-only'
import { testSandboxStub } from './helpers/context-test-helpers'
import type { EntityStreamDBWithActions } from '../src/types'
import type { ChangeEvent } from '@durable-streams/state'

function createMockDb(
  manifests: Array<Record<string, unknown>>,
  opts?: { slashCommands?: Array<Record<string, unknown>> }
): EntityStreamDBWithActions {
  const collections: Record<string, unknown> = {}

  for (const [name] of Object.entries(ENTITY_COLLECTIONS)) {
    collections[name] = createLocalOnlyTestCollection([], {
      id: `test-${name}`,
    })
  }

  collections.manifests = createLocalOnlyTestCollection(manifests, {
    id: `test-manifests`,
  })
  collections.slashCommands = {
    get: (key: string) =>
      opts?.slashCommands?.find((row) => row.key === key || row.name === key),
    toArray: opts?.slashCommands ?? [],
  }

  return {
    collections,
    actions: {},
    close: () => {},
    utils: {
      awaitTxId: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as EntityStreamDBWithActions
}

describe(`createHandlerContext`, () => {
  it(`exposes the current inbox wake on ctx.wake`, () => {
    const db = createMockDb([])

    const { ctx } = createHandlerContext({
      entityUrl: `/chat/test`,
      entityType: `chat`,
      epoch: 1,
      wakeOffset: `12`,
      firstWake: false,
      args: {},
      db,
      state: {},
      actions: {},
      electricTools: [],
      sandbox: testSandboxStub,
      events: [] as Array<ChangeEvent>,
      writeEvent: vi.fn(),
      wakeSession: {
        getPhase: () => `active`,
        registerManifestEntry: vi.fn(() => true),
        removeManifestEntry: vi.fn(() => false),
        commitManifestEntries: vi.fn(),
        rollbackManifestEntries: vi.fn(),
        registerSharedStateHandle: vi.fn(),
        registerSpawnHandle: vi.fn(),
        registerSourceHandle: vi.fn(),
        enqueueSend: vi.fn(),
        getManifest: vi.fn(() => []),
        getPendingSends: vi.fn(() => []),
        getSharedStateHandles: vi.fn(() => new Map()),
        getSpawnHandles: vi.fn(() => new Map()),
        getSourceHandles: vi.fn(() => new Map()),
        finishSetup: vi.fn(() => ({
          manifest: [],
          sharedStateHandles: new Map(),
          spawnHandles: new Map(),
          sourceHandles: new Map(),
        })),
        close: vi.fn(),
      } as any,
      wakeEvent: {
        type: `inbox`,
        source: `/principal/user-1`,
        fromOffset: 12,
        toOffset: 12,
        eventCount: 1,
        payload: { source: `/quickstart` },
        summary: `composer_input`,
      },
      doObserve: vi.fn(),
      doSpawn: vi.fn(),
      doMkdb: vi.fn(),
      executeSend: vi.fn(),
      tags: {},
      doSetTag: vi.fn().mockResolvedValue(undefined),
      doDeleteTag: vi.fn().mockResolvedValue(undefined),
    })

    expect(ctx.wake).toMatchObject({
      type: `inbox`,
      source: `/principal/user-1`,
      message: {
        type: `composer_input`,
        payload: { source: `/quickstart` },
        from: `/principal/user-1`,
      },
    })
  })

  it(`registers and reconciles dynamic slash commands`, () => {
    const db = createMockDb([], {
      slashCommands: [
        {
          key: `quickstart`,
          name: `quickstart`,
          description: `Static quickstart`,
          source: `static`,
          updated_at: `2026-01-01T00:00:00.000Z`,
        },
        {
          key: `search`,
          name: `search`,
          description: `Search docs`,
          source: `dynamic`,
          owner: `skills`,
          updated_at: `2026-01-01T00:00:00.000Z`,
        },
      ],
    })
    const writes: Array<ChangeEvent> = []

    const { ctx } = createHandlerContext({
      entityUrl: `/chat/test`,
      entityType: `chat`,
      epoch: 1,
      wakeOffset: `12`,
      firstWake: false,
      args: {},
      db,
      state: {},
      actions: {},
      staticSlashCommands: [
        { name: `quickstart`, description: `Static quickstart` },
      ],
      electricTools: [],
      sandbox: testSandboxStub,
      events: [] as Array<ChangeEvent>,
      writeEvent: (event) => writes.push(event),
      wakeSession: {
        getPhase: () => `active`,
        registerManifestEntry: vi.fn(() => true),
        removeManifestEntry: vi.fn(() => false),
        commitManifestEntries: vi.fn(),
        rollbackManifestEntries: vi.fn(),
        registerSharedStateHandle: vi.fn(),
        registerSpawnHandle: vi.fn(),
        registerSourceHandle: vi.fn(),
        enqueueSend: vi.fn(),
        getManifest: vi.fn(() => []),
        getPendingSends: vi.fn(() => []),
        getSharedStateHandles: vi.fn(() => new Map()),
        getSpawnHandles: vi.fn(() => new Map()),
        getSourceHandles: vi.fn(() => new Map()),
        finishSetup: vi.fn(() => ({
          manifest: [],
          sharedStateHandles: new Map(),
          spawnHandles: new Map(),
          sourceHandles: new Map(),
        })),
        close: vi.fn(),
      } as any,
      wakeEvent: {
        type: `inbox`,
        source: `/principal/user-1`,
        fromOffset: 12,
        toOffset: 12,
        eventCount: 1,
        payload: { source: `/quickstart` },
        summary: `composer_input`,
      },
      doObserve: vi.fn(),
      doSpawn: vi.fn(),
      doMkdb: vi.fn(),
      executeSend: vi.fn(),
      tags: {},
      doSetTag: vi.fn().mockResolvedValue(undefined),
      doDeleteTag: vi.fn().mockResolvedValue(undefined),
    })

    ctx.slashCommands.register({
      name: `quickstart`,
      description: `Local quickstart`,
      owner: `local`,
    })
    ctx.slashCommands.register({
      name: `quickstart`,
      description: `Dynamic quickstart`,
      owner: `skills`,
    })
    ctx.slashCommands.replaceOwned(`skills`, [
      { name: `quickstart`, description: `Dynamic quickstart` },
    ])
    ctx.slashCommands.unregister(`quickstart`, { owner: `skills` })
    ctx.slashCommands.unregister(`quickstart`, { owner: `local` })

    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: `slash_command`,
          key: `quickstart`,
          value: expect.objectContaining({
            name: `quickstart`,
            description: `Local quickstart`,
            source: `dynamic`,
            owner: `local`,
          }),
        }),
        expect.objectContaining({
          type: `slash_command`,
          key: `quickstart`,
          value: expect.objectContaining({
            name: `quickstart`,
            description: `Dynamic quickstart`,
            source: `dynamic`,
            owner: `skills`,
            dynamic_layers: expect.arrayContaining([
              expect.objectContaining({
                owner: `local`,
                description: `Local quickstart`,
              }),
              expect.objectContaining({
                owner: `skills`,
                description: `Dynamic quickstart`,
              }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: `slash_command`,
          key: `search`,
          headers: expect.objectContaining({ operation: `delete` }),
        }),
        expect.objectContaining({
          type: `slash_command`,
          key: `quickstart`,
          value: expect.objectContaining({
            name: `quickstart`,
            description: `Local quickstart`,
            source: `dynamic`,
            owner: `local`,
          }),
        }),
        expect.objectContaining({
          type: `slash_command`,
          key: `quickstart`,
          value: expect.objectContaining({
            name: `quickstart`,
            description: `Static quickstart`,
            source: `static`,
          }),
        }),
      ])
    )
  })

  it(`uses cron schedule payload as the trigger message for cron wakes`, async () => {
    const expression = `*/5 * * * *`
    const timezone = `America/Denver`
    const cronSource = getCronStreamPath(expression, timezone)
    const db = createMockDb([
      {
        key: `schedule:heartbeat`,
        kind: `schedule`,
        id: `heartbeat`,
        scheduleType: `cron`,
        expression,
        timezone,
        payload: `load xyz skills`,
      },
    ])
    let receivedMessage = ``

    const { ctx } = createHandlerContext({
      entityUrl: `/chat/test`,
      entityType: `chat`,
      epoch: 1,
      wakeOffset: `-1`,
      firstWake: false,
      args: {},
      db,
      sandbox: testSandboxStub,
      state: {},
      actions: {},
      electricTools: [],
      events: [] as Array<ChangeEvent>,
      writeEvent: vi.fn(),
      wakeSession: {
        getPhase: () => `active`,
        registerManifestEntry: vi.fn(() => true),
        removeManifestEntry: vi.fn(() => false),
        commitManifestEntries: vi.fn(),
        rollbackManifestEntries: vi.fn(),
        registerSharedStateHandle: vi.fn(),
        registerSpawnHandle: vi.fn(),
        registerSourceHandle: vi.fn(),
        enqueueSend: vi.fn(),
        getManifest: vi.fn(() => []),
        getPendingSends: vi.fn(() => []),
        getSharedStateHandles: vi.fn(() => new Map()),
        getSpawnHandles: vi.fn(() => new Map()),
        getSourceHandles: vi.fn(() => new Map()),
        finishSetup: vi.fn(() => ({
          manifest: [],
          sharedStateHandles: new Map(),
          spawnHandles: new Map(),
          sourceHandles: new Map(),
        })),
        close: vi.fn(),
      } as any,
      wakeEvent: {
        type: `wake`,
        source: cronSource,
        fromOffset: 0,
        toOffset: 0,
        eventCount: 1,
        payload: undefined,
      },
      doObserve: vi.fn(),
      doSpawn: vi.fn(),
      doMkdb: vi.fn(),
      executeSend: vi.fn(),
      tags: {},
      doSetTag: vi.fn().mockResolvedValue(undefined),
      doDeleteTag: vi.fn().mockResolvedValue(undefined),
    })

    ctx.useAgent({
      systemPrompt: `test`,
      model: `test-model`,
      tools: [],
      testResponses: async (message) => {
        receivedMessage = message
        return undefined
      },
    })

    await ctx.agent.run()

    expect(receivedMessage).toBe(`load xyz skills`)
  })

  it(`uses hydrated event source wake data as the trigger message`, async () => {
    const db = createMockDb([])
    let receivedMessage = ``
    const hydratedEventSourceWake = {
      type: `event_source_wake` as const,
      source: `/_webhooks/github-repo/prs/42`,
      sourceType: `webhook` as const,
      endpointKey: `github-repo`,
      sourceKey: `github-repo`,
      subscription: {
        id: `watch-pr-42`,
        bucketKey: `pull_request`,
        params: { number: 42 },
      },
      bucket: `prs/42`,
      changes: [
        {
          collection: `webhook_event`,
          kind: `insert` as const,
          key: `event-42`,
        },
      ],
      events: [
        {
          key: `event-42`,
          body: {
            comment: {
              body: `Please tell the user a joke when this wakes you up.`,
            },
          },
          event_type: `issue_comment`,
          endpoint_key: `github-repo`,
          bucket: `prs/42`,
          stream_path: `/_webhooks/github-repo/prs/42`,
          headers: { 'x-github-event': `issue_comment` },
          received_at: `2026-05-23T00:00:00.000Z`,
          request: {
            method: `POST`,
            content_type: `application/json`,
            size_bytes: 2,
            query: {},
          },
        },
      ],
    }

    const { ctx } = createHandlerContext({
      entityUrl: `/chat/test`,
      entityType: `chat`,
      epoch: 1,
      wakeOffset: `-1`,
      firstWake: false,
      args: {},
      db,
      sandbox: testSandboxStub,
      state: {},
      actions: {},
      electricTools: [],
      events: [] as Array<ChangeEvent>,
      writeEvent: vi.fn(),
      wakeSession: {
        getPhase: () => `active`,
        registerManifestEntry: vi.fn(() => true),
        removeManifestEntry: vi.fn(() => false),
        commitManifestEntries: vi.fn(),
        rollbackManifestEntries: vi.fn(),
        registerSharedStateHandle: vi.fn(),
        registerSpawnHandle: vi.fn(),
        registerSourceHandle: vi.fn(),
        enqueueSend: vi.fn(),
        getManifest: vi.fn(() => []),
        getPendingSends: vi.fn(() => []),
        getSharedStateHandles: vi.fn(() => new Map()),
        getSpawnHandles: vi.fn(() => new Map()),
        getSourceHandles: vi.fn(() => new Map()),
        finishSetup: vi.fn(() => ({
          manifest: [],
          sharedStateHandles: new Map(),
          spawnHandles: new Map(),
          sourceHandles: new Map(),
        })),
        close: vi.fn(),
      } as any,
      wakeEvent: {
        type: `wake`,
        source: `/_webhooks/github-repo/prs/42`,
        fromOffset: 0,
        toOffset: 0,
        eventCount: 1,
        payload: {
          source: `/_webhooks/github-repo/prs/42`,
          timeout: false,
          changes: [
            {
              collection: `webhook_event`,
              kind: `insert`,
              key: `event-42`,
            },
          ],
        },
      },
      hydratedEventSourceWake,
      doObserve: vi.fn(),
      doSpawn: vi.fn(),
      doMkdb: vi.fn(),
      executeSend: vi.fn(),
      tags: {},
      doSetTag: vi.fn().mockResolvedValue(undefined),
      doDeleteTag: vi.fn().mockResolvedValue(undefined),
    })

    ctx.useAgent({
      systemPrompt: `test`,
      model: `test-model`,
      tools: [],
      testResponses: async (message) => {
        receivedMessage = message
        return undefined
      },
    })

    await ctx.agent.run()

    expect(JSON.parse(receivedMessage)).toMatchObject({
      type: `event_source_wake`,
      source: `/_webhooks/github-repo/prs/42`,
      events: [
        {
          body: {
            comment: {
              body: `Please tell the user a joke when this wakes you up.`,
            },
          },
        },
      ],
    })
  })
})
