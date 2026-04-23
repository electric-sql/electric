import { describe, expect, it, vi } from 'vitest'
import { getCronStreamPath } from '../src/cron-utils'
import { createHandlerContext } from '../src/context-factory'
import { ENTITY_COLLECTIONS } from '../src/entity-schema'
import { createLocalOnlyTestCollection } from './helpers/local-only'
import type { EntityStreamDBWithActions } from '../src/types'
import type { ChangeEvent } from '@durable-streams/state'

function createMockDb(
  manifests: Array<Record<string, unknown>>
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
      doRemoveTag: vi.fn().mockResolvedValue(undefined),
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
})
