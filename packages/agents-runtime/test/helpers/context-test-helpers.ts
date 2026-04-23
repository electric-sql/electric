import { vi } from 'vitest'
import { createHandlerContext } from '../../src/context-factory'
import { assembleContext } from '../../src/context-assembly'
import { ENTITY_COLLECTIONS, builtInCollections } from '../../src/entity-schema'
import { timelineToMessages } from '../../src/timeline-context'
import { createLocalOnlyTestCollection } from './local-only'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  ContextEntry,
  HandlerContext,
  LLMMessage,
  TimestampedMessage,
  UseContextConfig,
  WakeSession,
} from '../../src/types'

type DebugContext = {
  __debug: {
    useContextRegistrations: () => number
  }
}

type FixtureKind =
  | `run`
  | `text`
  | `text_delta`
  | `tool_call`
  | `message_received`
  | `wake`
  | `context_inserted`
  | `context_removed`

type FixtureEvent = {
  kind: FixtureKind
  at: number
  key?: string
  value?: Record<string, unknown>
}

function offset(at: number): string {
  return `0000000000000000_${at.toString().padStart(16, `0`)}`
}

function rowForFixture(item: FixtureEvent): {
  collection: keyof typeof ENTITY_COLLECTIONS
  row: Record<string, unknown>
  key: string
} {
  const key = item.key ?? `${item.kind}-${item.at}`

  switch (item.kind) {
    case `run`:
      return {
        collection: `runs`,
        key,
        row: { key, status: `completed`, ...item.value },
      }
    case `text`:
      return {
        collection: `texts`,
        key,
        row: { key, run_id: `run-1`, status: `completed`, ...item.value },
      }
    case `text_delta`:
      return {
        collection: `textDeltas`,
        key,
        row: { key, text_id: `text-1`, delta: ``, ...item.value },
      }
    case `tool_call`:
      return {
        collection: `toolCalls`,
        key,
        row: {
          key,
          run_id: `run-1`,
          tool_name: `tool`,
          status: `completed`,
          ...item.value,
        },
      }
    case `message_received`:
      return {
        collection: `inbox`,
        key,
        row: {
          key,
          from: `user`,
          payload: ``,
          timestamp: `2026-04-13T00:00:00.000Z`,
          ...item.value,
        },
      }
    case `wake`:
      return {
        collection: `wakes`,
        key,
        row: {
          key,
          timestamp: `2026-04-13T00:00:00.000Z`,
          source: `/child/test`,
          timeout: false,
          changes: [],
          ...item.value,
        },
      }
    case `context_inserted`:
      return {
        collection: `contextInserted`,
        key,
        row: {
          key,
          id: key,
          name: `context_entry`,
          attrs: {},
          content: ``,
          timestamp: `2026-04-13T00:00:00.000Z`,
          ...item.value,
        },
      }
    case `context_removed`:
      return {
        collection: `contextRemoved`,
        key,
        row: {
          key,
          id: key,
          name: `context_entry`,
          timestamp: `2026-04-13T00:00:00.000Z`,
          ...item.value,
        },
      }
  }
}

export function buildStreamFixture(items: Array<FixtureEvent>) {
  const rowsByCollection = new Map<string, Array<Record<string, unknown>>>()
  const offsetsByCollection = new Map<string, Map<string, string>>()

  for (const [, name] of Object.entries(ENTITY_COLLECTIONS)) {
    rowsByCollection.set(name, [])
    offsetsByCollection.set(name, new Map())
  }

  for (const item of items) {
    const row = rowForFixture(item)
    rowsByCollection.get(row.collection)?.push(row.row)
    offsetsByCollection.get(row.collection)?.set(row.key, offset(item.at))
  }

  const collections: Record<string, any> = {}
  for (const [name] of Object.entries(ENTITY_COLLECTIONS)) {
    const collection = createLocalOnlyTestCollection(
      rowsByCollection.get(name) ?? []
    ) as any
    collection.__electricRowOffsets = offsetsByCollection.get(name) ?? new Map()
    collections[name] = collection
  }

  const typeToCollection = new Map(
    Object.entries(builtInCollections).map(([name, definition]) => [
      definition.type,
      name,
    ])
  )
  let nextOffset = items.length + 1

  const db = {
    collections,
    actions: {},
    close: () => {},
    utils: {
      awaitTxId: vi.fn().mockResolvedValue(undefined),
      createWriteTransaction: vi.fn(),
      awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
      drainPendingWrites: vi.fn().mockResolvedValue(undefined),
      applyEvent: vi.fn((event: ChangeEvent) => {
        const collectionName = typeToCollection.get(event.type)
        if (!collectionName) {
          return {}
        }
        const collection = collections[collectionName]
        const primaryKey = builtInCollections[collectionName]!.primaryKey
        const row = {
          ...(event.value as Record<string, unknown>),
          [primaryKey]: event.key,
        }
        const op = event.headers.operation
        if (op === `delete`) {
          collection.delete(event.key)
        } else if (op === `insert`) {
          collection.insert(row)
        } else if (collection.has(event.key)) {
          collection.update(event.key, (draft: Record<string, unknown>) => {
            for (const key of Object.keys(draft)) {
              delete draft[key]
            }
            Object.assign(draft, row)
          })
        } else {
          collection.insert(row)
        }
        collection.__electricRowOffsets?.set(event.key, offset(nextOffset++))
        return {}
      }),
    },
  }

  return db as any
}

export function createFakeWakeSession(
  db: ReturnType<typeof buildStreamFixture>
) {
  const manifests = db.collections.manifests
  return {
    getPhase: () => `active`,
    registerManifestEntry(entry: { key: string }) {
      if (manifests.has(entry.key)) {
        manifests.update(entry.key, (draft: Record<string, unknown>) => {
          for (const key of Object.keys(draft)) {
            delete draft[key]
          }
          Object.assign(draft, entry)
        })
      } else {
        manifests.insert(entry)
      }
      return true
    },
    removeManifestEntry(key: string) {
      if (!manifests.has(key)) {
        return false
      }
      manifests.delete(key)
      return true
    },
    commitManifestEntries: async () => {},
    rollbackManifestEntries: () => {},
    registerSharedStateHandle: () => {},
    registerSpawnHandle: () => {},
    registerSourceHandle: () => {},
    enqueueSend: () => {},
    getManifest: () => manifests.toArray,
    getPendingSends: () => [],
    getSharedStateHandles: () => new Map(),
    getSpawnHandles: () => new Map(),
    getSourceHandles: () => new Map(),
    finishSetup: () => ({
      manifest: [],
      sharedStateHandles: new Map(),
      spawnHandles: new Map(),
      sourceHandles: new Map(),
    }),
    close: async () => {},
  } as unknown as WakeSession
}

export function createTestHandlerContext(
  opts: {
    db?: ReturnType<typeof buildStreamFixture>
    writeEvent?: (event: ChangeEvent) => void
  } = {}
) {
  const db = opts.db ?? buildStreamFixture([])
  const writeEvent =
    opts.writeEvent ?? ((event: ChangeEvent) => db.utils.applyEvent(event))
  return createHandlerContext({
    entityUrl: `/test/entity`,
    entityType: `test`,
    epoch: 1,
    wakeOffset: `-1`,
    firstWake: false,
    tags: {},
    args: {},
    db,
    state: {},
    actions: {},
    electricTools: [],
    events: [],
    writeEvent,
    wakeSession: createFakeWakeSession(db),
    wakeEvent: {
      type: `message_received`,
      source: `/test`,
      fromOffset: 0,
      toOffset: 0,
      eventCount: 1,
      payload: `hi`,
    },
    doObserve: vi.fn(),
    doSpawn: vi.fn(),
    doMkdb: vi.fn(),
    executeSend: vi.fn(),
    doSetTag: vi.fn(async () => undefined),
    doRemoveTag: vi.fn(async () => undefined),
  })
}

export async function captureAssembledMessages(
  config: UseContextConfig
): Promise<Array<TimestampedMessage>> {
  return assembleContext(config)
}

export function getUseContextRegistrations(ctx: HandlerContext): number {
  return (ctx as unknown as DebugContext).__debug.useContextRegistrations()
}

function stripAt(message: TimestampedMessage): LLMMessage {
  const { at: _at, ...rest } = message
  return rest as LLMMessage
}

export function assertParityWithLegacyTimeline(ctx: HandlerContext): void {
  const fresh = ctx.timelineMessages().map(stripAt)
  const legacy = timelineToMessages(ctx.db)
  if (JSON.stringify(fresh) !== JSON.stringify(legacy)) {
    throw new Error(
      `Parity mismatch between timelineMessages() and timelineToMessages(db).\n` +
        `fresh: ${JSON.stringify(fresh)}\nlegacy: ${JSON.stringify(legacy)}`
    )
  }
}

export function assertContextEntries(
  ctx: HandlerContext,
  expected: Array<ContextEntry>
): void {
  const actual = [...ctx.listContext()].sort((left, right) =>
    left.id.localeCompare(right.id)
  )
  const sortedExpected = [...expected].sort((left, right) =>
    left.id.localeCompare(right.id)
  )
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `Context entry mismatch.\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(sortedExpected)}`
    )
  }
}
