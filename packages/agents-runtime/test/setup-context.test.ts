import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTransaction, eq, queryOnce } from '@durable-streams/state'
import { getCronSourceRef } from '../src/cron-utils'
import {
  manifestChildKey,
  manifestEffectKey,
  manifestSharedStateKey,
  manifestSourceKey,
} from '../src/manifest-helpers'
import { cron, db, entity } from '../src/observation-sources'
import { createSetupContext } from '../src/setup-context'
import { ENTITY_COLLECTIONS, passthrough } from '../src/entity-schema'
import { createLocalOnlyTestCollection } from './helpers/local-only'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  EntityStreamDBWithActions,
  ObservationSource,
  SharedStateSchemaMap,
} from '../src/types'
import type { SetupContextResult } from '../src/setup-context'

const passthroughSchema = passthrough<Record<string, unknown>>()

describe(`createSetupContext`, () => {
  const collectionCleanups = new Set<() => Promise<void>>()

  afterEach(async () => {
    const cleanups = [...collectionCleanups]
    collectionCleanups.clear()
    await Promise.all(cleanups.map((cleanup) => cleanup()))
  })

  interface MockCollection {
    has: (key: string) => boolean
    id: string
    cleanup: () => Promise<void>
    toArray: Array<Record<string, unknown>>
    get: (key: string) => Record<string, unknown> | undefined
    insert: (value: Record<string, unknown>) => unknown
    update: (
      key: string,
      updater: (draft: Record<string, unknown>) => void
    ) => unknown
    delete: (key: string) => unknown
    utils: {
      acceptMutations: (transaction: {
        mutations: Array<{ collection: { id: string } }>
      }) => void
    }
  }

  function createMockCollection(rows: Array<unknown>): MockCollection {
    const collection = createLocalOnlyTestCollection(
      rows as Array<Record<string, unknown>>
    ) as unknown as MockCollection
    collectionCleanups.add(() => collection.cleanup())
    return collection
  }

  function createMockWriteTransaction(
    collections: Record<string, MockCollection>
  ) {
    return (opts?: { autoCommit?: boolean }) => {
      const transaction = createTransaction<Record<string, unknown>>({
        autoCommit: opts?.autoCommit ?? true,
        mutationFn: async ({ transaction }) => {
          for (const collection of Object.values(collections)) {
            collection.utils.acceptMutations(transaction)
          }
        },
      })
      void transaction.isPersisted.promise.catch(() => undefined)
      return transaction
    }
  }

  function mockDb(
    overrides: Partial<Record<string, Array<unknown>>> = {},
    awaitTxId: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
    actions: Record<string, ReturnType<typeof vi.fn>> = {}
  ): EntityStreamDBWithActions {
    const collections: Record<string, MockCollection> = {}
    for (const [name] of Object.entries(ENTITY_COLLECTIONS)) {
      collections[name] = createMockCollection(overrides[name] ?? [])
    }
    // Also add any custom state collections from overrides
    for (const name of Object.keys(overrides)) {
      if (!collections[name]) {
        collections[name] = createMockCollection(overrides[name] ?? [])
      }
    }
    const createWriteTransaction = createMockWriteTransaction(collections)
    return {
      collections,
      close: () => {},
      utils: {
        awaitTxId,
        createWriteTransaction,
        awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
        drainPendingWrites: vi.fn().mockResolvedValue(undefined),
        applyEvent: (event: ChangeEvent) => {
          const collectionNameByType: Record<string, string> = {
            error: `errors`,
            manifest: `manifests`,
          }
          const collectionName = collectionNameByType[event.type]
          if (!collectionName) {
            return createWriteTransaction()
          }
          const collection = collections[collectionName]
          const transaction = createWriteTransaction()
          transaction.mutate(() => {
            if (event.headers.operation === `delete`) {
              collection?.delete(event.key)
              return
            }
            const row = {
              ...(event.value as Record<string, unknown>),
              key: event.key,
            }
            if (
              event.headers.operation === `update` &&
              collection?.has(event.key)
            ) {
              collection.update(event.key, (draft) => {
                for (const key of Object.keys(draft)) {
                  delete draft[key]
                }
                Object.assign(draft, row)
              })
              return
            }
            collection?.insert(row)
          })
          return transaction
        },
      },
      actions,
    } as unknown as EntityStreamDBWithActions
  }

  function makeCtx(
    events: Array<ChangeEvent> = [],
    dbOverrides: Partial<Record<string, Array<unknown>>> = {},
    effectScope?: any,
    args: Record<string, unknown> = {},
    customStateNames: Array<string> = [],
    actions: Record<string, ReturnType<typeof vi.fn>> = {}
  ) {
    effectScope ??= {
      register: vi.fn(),
      disposeAll: vi.fn().mockResolvedValue(undefined),
    } as never
    const writes: Array<unknown> = []
    const awaitTxId = vi.fn().mockResolvedValue(undefined)
    const db = mockDb(dbOverrides, awaitTxId, actions)
    return {
      ctx: createSetupContext({
        entityUrl: `test-entity-1`,
        entityType: `test-agent`,
        args: Object.freeze(args),
        db,
        events,
        writeEvent: (e: ChangeEvent) => {
          writes.push(e)
        },
        serverBaseUrl: `http://localhost:3000`,
        effectScope,
        customStateNames,
      }),
      db,
      writes,
      awaitTxId,
    }
  }

  /**
   * Build a mock EntityStreamDBWithActions for a shared state schema and wire
   * it into the context's shared state handle. This simulates what processWake
   * does between setup() and agent execution.
   */
  function mockSharedStateDb(
    schema: SharedStateSchemaMap,
    initialRows: Partial<Record<string, Array<Record<string, unknown>>>> = {}
  ): EntityStreamDBWithActions {
    interface MockColl {
      toArray: Array<Record<string, unknown>>
      get: (key: string) => Record<string, unknown> | undefined
      insert: (value: object) => unknown
      update: (key: string, updater: (draft: object) => void) => unknown
      delete: (key: string) => unknown
    }
    const collections: Record<string, MockColl> = {}
    const actions: Record<string, (...args: Array<unknown>) => unknown> = {}

    for (const [collName, collSchema] of Object.entries(schema)) {
      const pk = collSchema.primaryKey

      const coll = createLocalOnlyTestCollection(
        (initialRows[collName] ?? []).map((row) => ({ ...row })),
        {
          getKey: (row) => {
            const key = row[pk]
            if (typeof key === `string` || typeof key === `number`) {
              return String(key)
            }
            throw new Error(
              `Shared-state mock row for "${collName}" is missing primary key "${pk}"`
            )
          },
        }
      ) as unknown as MockColl
      collections[collName] = coll

      actions[`${collName}_insert`] = ((arg: unknown) => {
        const { row } = arg as { row: Record<string, unknown> }
        coll.insert(row)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [
            { collection: { id: `shared-state:${collName}` }, type: `insert` },
          ],
        }
      }) as (...args: Array<unknown>) => unknown
      actions[`${collName}_update`] = ((arg: unknown) => {
        const { key, updater } = arg as {
          key: string
          updater: (draft: Record<string, unknown>) => void
        }
        coll.update(key, updater as (draft: object) => void)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [
            { collection: { id: `shared-state:${collName}` }, type: `update` },
          ],
        }
      }) as (...args: Array<unknown>) => unknown
      actions[`${collName}_delete`] = ((arg: unknown) => {
        const { key } = arg as { key: string }
        coll.delete(key)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [
            { collection: { id: `shared-state:${collName}` }, type: `delete` },
          ],
        }
      }) as (...args: Array<unknown>) => unknown
    }
    const createWriteTransaction = createMockWriteTransaction(
      collections as Record<string, MockCollection>
    )

    return {
      collections,
      close: () => {},
      utils: {
        awaitTxId: vi.fn().mockResolvedValue(undefined),
        awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
        drainPendingWrites: vi.fn().mockResolvedValue(undefined),
        createWriteTransaction,
      },
      actions,
    } as unknown as EntityStreamDBWithActions
  }

  /**
   * Wire all shared state handles in a setup context with mock dbs.
   * Call this after mkdb/observe(db(...)) but before using
   * collection operations.
   */
  async function wireSharedState(
    ctx: SetupContextResult,
    schema: SharedStateSchemaMap,
    initialRows: Partial<Record<string, Array<Record<string, unknown>>>> = {}
  ): Promise<void> {
    for (const [, handle] of ctx.getSharedStateHandles()) {
      await handle.wireDb(mockSharedStateDb(schema, initialRows))
    }
  }

  it(`exposes entityUrl and entityType`, () => {
    const { ctx } = makeCtx()
    expect(ctx.entityUrl).toBe(`test-entity-1`)
    expect(ctx.entityType).toBe(`test-agent`)
  })

  it(`ctx.args is populated from entity metadata`, () => {
    const { ctx } = makeCtx([], {}, undefined, {
      userId: `user-42`,
      plan: `pro`,
    })
    expect(ctx.args).toEqual({ userId: `user-42`, plan: `pro` })
  })

  it(`ctx.args is immutable (frozen)`, () => {
    const { ctx } = makeCtx([], {}, undefined, {
      userId: `user-42`,
    })
    expect(() => {
      ;(ctx.args as Record<string, unknown>).userId = `mutated`
    }).toThrow()
    expect(ctx.args.userId).toBe(`user-42`)
  })

  it(`ctx.args defaults to empty object when no metadata`, () => {
    const { ctx } = makeCtx()
    expect(ctx.args).toEqual({})
  })

  it(`spawn registers a child entity in the manifest`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`code-linter`, `linter-1`, { pr: 42 })
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`linter-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    expect(handle.entityUrl).toBe(`/code-linter/linter-1`)
    expect(handle.type).toBe(`code-linter`)
    const manifest = ctx.getManifest()
    expect(manifest).toContainEqual({
      kind: `child`,
      key: manifestChildKey(`code-linter`, `linter-1`),
      id: `linter-1`,
      entity_type: `code-linter`,
      entity_url: `/code-linter/linter-1`,
      observed: true,
    })
  })

  it(`send collects pending sends (not manifest, not writeEvent — deferred to processWake)`, () => {
    const { ctx, writes } = makeCtx()
    ctx.setInSetup(false)
    ctx.send(`other-entity`, { text: `hello` }, { type: `greeting` })
    expect(writes).toHaveLength(0)
    const sends = ctx.getPendingSends()
    expect(sends).toHaveLength(1)
    expect(sends[0]).toEqual({
      targetUrl: `other-entity`,
      payload: { text: `hello` },
      type: `greeting`,
    })
    const manifest = ctx.getManifest()
    expect(manifest.find((e) => (e.kind as string) === `send`)).toBeUndefined()
  })

  it(`observe registers an observation in the manifest`, async () => {
    const { ctx } = makeCtx()
    const handlePromise = ctx.observe(entity(`parent-entity`))
    const manifest = ctx.getManifest()
    expect(manifest).toContainEqual({
      kind: `source`,
      key: manifestSourceKey(`entity`, `parent-entity`),
      sourceType: `entity`,
      sourceRef: `parent-entity`,
      config: { entityUrl: `parent-entity` },
    })
    // Resolve the observe handle by wiring the db
    const observeHandles = ctx.getSourceHandles()
    const observeHandle = observeHandles.get(`parent-entity`)
    observeHandle?.wireDb?.(mockDb())
    const handle = await handlePromise
    expect(handle.sourceRef).toBe(`parent-entity`)
  })

  // ====================================================================
  // ctx.state proxy tests
  // ====================================================================

  it(`ctx.state.collection.insert calls the auto-generated insert action and returns Transaction`, () => {
    const mockTransaction = {
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    }
    const insertAction = vi.fn().mockReturnValue(mockTransaction)

    const { ctx } = makeCtx(
      [],
      { bids: [{ key: `bid-1`, amount: 100 }] },
      undefined,
      {},
      [`bids`],
      { bids_insert: insertAction, bids_update: vi.fn(), bids_delete: vi.fn() }
    )

    const tx = ctx.state.bids!.insert({ key: `bid-2`, amount: 200 })
    expect(insertAction).toHaveBeenCalledWith({
      row: { key: `bid-2`, amount: 200 },
    })
    expect(tx).toBe(mockTransaction)
  })

  it(`ctx.state.collection.update calls the auto-generated update action and returns Transaction`, () => {
    const mockTransaction = {
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    }
    const updateAction = vi.fn().mockReturnValue(mockTransaction)
    const updater = (draft: Record<string, unknown>) => {
      draft.amount = 300
    }

    const { ctx } = makeCtx(
      [],
      { bids: [{ key: `bid-1`, amount: 100 }] },
      undefined,
      {},
      [`bids`],
      { bids_insert: vi.fn(), bids_update: updateAction, bids_delete: vi.fn() }
    )

    const tx = ctx.state.bids!.update(`bid-1`, updater)
    expect(updateAction).toHaveBeenCalledWith({
      key: `bid-1`,
      updater,
    })
    expect(tx).toBe(mockTransaction)
  })

  it(`ctx.state.collection.delete calls the auto-generated delete action and returns Transaction`, () => {
    const mockTransaction = {
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    }
    const deleteAction = vi.fn().mockReturnValue(mockTransaction)

    const { ctx } = makeCtx(
      [],
      { bids: [{ key: `bid-1`, amount: 100 }] },
      undefined,
      {},
      [`bids`],
      { bids_insert: vi.fn(), bids_update: vi.fn(), bids_delete: deleteAction }
    )

    const tx = ctx.state.bids!.delete(`bid-1`)
    expect(deleteAction).toHaveBeenCalledWith({ key: `bid-1` })
    expect(tx).toBe(mockTransaction)
  })

  it(`ctx.state.collection.get reads from the live collection (synchronous)`, () => {
    const { ctx } = makeCtx(
      [],
      { bids: [{ key: `bid-1`, amount: 100 }] },
      undefined,
      {},
      [`bids`],
      { bids_insert: vi.fn(), bids_update: vi.fn(), bids_delete: vi.fn() }
    )

    const result = ctx.state.bids!.get(`bid-1`)
    expect(result).toEqual({ key: `bid-1`, amount: 100 })
  })

  it(`ctx.state.collection.get returns undefined for missing key`, () => {
    const { ctx } = makeCtx(
      [],
      { bids: [{ key: `bid-1`, amount: 100 }] },
      undefined,
      {},
      [`bids`],
      { bids_insert: vi.fn(), bids_update: vi.fn(), bids_delete: vi.fn() }
    )

    const result = ctx.state.bids!.get(`nonexistent`)
    expect(result).toBeUndefined()
  })

  it(`ctx.state.collection.toArray reads from the live collection`, () => {
    const { ctx } = makeCtx(
      [],
      {
        bids: [
          { key: `bid-1`, amount: 100 },
          { key: `bid-2`, amount: 200 },
        ],
      },
      undefined,
      {},
      [`bids`],
      { bids_insert: vi.fn(), bids_update: vi.fn(), bids_delete: vi.fn() }
    )

    const arr = ctx.state.bids!.toArray
    expect(arr).toHaveLength(2)
    expect(arr[0]).toEqual({ key: `bid-1`, amount: 100 })
    expect(arr[1]).toEqual({ key: `bid-2`, amount: 200 })
  })

  // ====================================================================
  // ctx.actions tests
  // ====================================================================

  it(`ctx.actions exposes custom actions (not CRUD actions)`, () => {
    const mockTx = { isPersisted: { promise: Promise.resolve() } }
    const acceptBid = vi.fn().mockReturnValue(mockTx)

    const { ctx } = makeCtx([], { bids: [] }, undefined, {}, [`bids`], {
      bids_insert: vi.fn(),
      bids_update: vi.fn(),
      bids_delete: vi.fn(),
      acceptBid,
    })

    // Custom action is exposed
    expect(ctx.actions.acceptBid).toBeDefined()

    // CRUD actions are NOT exposed on ctx.actions (they go through ctx.state)
    expect(ctx.actions.bids_insert).toBeUndefined()
    expect(ctx.actions.bids_update).toBeUndefined()
    expect(ctx.actions.bids_delete).toBeUndefined()
  })

  it(`ctx.actions.customAction returns Transaction`, () => {
    const mockTx = {
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [
        { collection: { id: `stream-db:bids` }, type: `update` },
        { collection: { id: `stream-db:status` }, type: `update` },
      ],
    }
    const acceptBid = vi.fn().mockReturnValue(mockTx)

    const { ctx } = makeCtx(
      [],
      { bids: [], status: [] },
      undefined,
      {},
      [`bids`, `status`],
      {
        bids_insert: vi.fn(),
        bids_update: vi.fn(),
        bids_delete: vi.fn(),
        status_insert: vi.fn(),
        status_update: vi.fn(),
        status_delete: vi.fn(),
        acceptBid,
      }
    )

    const tx = ctx.actions.acceptBid!(`bid-1`)
    expect(acceptBid).toHaveBeenCalledWith(`bid-1`)
    expect(tx).toBe(mockTx)
  })

  // ====================================================================
  // State proxy with empty custom state
  // ====================================================================

  it(`ctx.state is empty object when no custom state defined`, () => {
    const { ctx } = makeCtx()
    expect(Object.keys(ctx.state)).toHaveLength(0)
  })

  it(`ctx.actions is empty object when no custom actions defined`, () => {
    const { ctx } = makeCtx()
    expect(Object.keys(ctx.actions)).toHaveLength(0)
  })

  it(`ctx.actions is empty object when db.actions is missing entirely`, () => {
    const db = {
      collections: Object.fromEntries(
        Object.keys(ENTITY_COLLECTIONS).map((name) => [
          name,
          createMockCollection([]),
        ])
      ),
      close: () => {},
      utils: {
        awaitTxId: vi.fn().mockResolvedValue(undefined),
        awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
        drainPendingWrites: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as EntityStreamDBWithActions

    const ctx = createSetupContext({
      entityUrl: `test-entity-1`,
      entityType: `test-agent`,
      args: Object.freeze({}),
      db,
      events: [],
      writeEvent: () => {},
      serverBaseUrl: `http://localhost:3000`,
      effectScope: {
        register: vi.fn(),
        disposeAll: vi.fn().mockResolvedValue(undefined),
      } as never,
      customStateNames: [],
    })

    expect(Object.keys(ctx.actions)).toHaveLength(0)
  })

  // ====================================================================
  // Other resource tests (effect, agent, manifest)
  // ====================================================================

  it(`createEffect registers an effect in the manifest`, () => {
    const { ctx } = makeCtx()
    const created = ctx.createEffect(`watch-child`, `child-1`, {
      entityUrl: `/worker/1`,
    })
    expect(created).toBe(true)
    const manifest = ctx.getManifest()
    const effect = manifest.find((e) => e.kind === `effect`)
    expect(effect).toBeDefined()
    expect(effect?.key).toBe(manifestEffectKey(`watch-child`, `child-1`))
  })

  it(`send with afterMs includes delay in pending sends`, () => {
    const { ctx } = makeCtx()
    ctx.setInSetup(false)
    ctx.send(`other-entity`, { text: `later` }, { afterMs: 60_000 })
    const sends = ctx.getPendingSends()
    expect(sends).toHaveLength(1)
    expect(sends[0]).toEqual({
      targetUrl: `other-entity`,
      payload: { text: `later` },
      afterMs: 60_000,
    })
  })

  it(`getManifest returns idempotent resource registrations only`, () => {
    const { ctx } = makeCtx()
    // spawn() returns a Promise now, but manifest registration is synchronous
    // so we don't need to await for the manifest check
    void ctx.spawn(`worker`, `w-1`)
    void ctx.spawn(`worker`, `w-1`)
    void ctx.observe(entity(`parent`))
    void ctx.observe(entity(`parent`))
    ctx.setInSetup(false)
    ctx.send(`some-entity`, { text: `hello` })
    const manifest = ctx.getManifest()
    expect(manifest).toHaveLength(2)
    expect(manifest.map((m) => m.kind).sort()).toEqual([`child`, `source`])
  })

  // ====================================================================
  // Enhanced spawn handle tests
  // ====================================================================

  it(`spawn auto-observes the child on the child manifest row`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`code-linter`, `linter-1`, { pr: 42 })
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`linter-1`)!.wireDb(mockDb())
    await spawnPromise
    const manifest = ctx.getManifest()
    expect(manifest).toEqual([
      {
        kind: `child`,
        key: manifestChildKey(`code-linter`, `linter-1`),
        id: `linter-1`,
        entity_type: `code-linter`,
        entity_url: `/code-linter/linter-1`,
        observed: true,
      },
    ])
  })

  it(`spawn handle has entityUrl, type, db, run (getter), send (function), status`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    const childDb = mockDb()
    spawnHandles.get(`w-1`)!.wireDb(childDb)
    const handle = await spawnPromise
    expect(handle.entityUrl).toBe(`/worker/w-1`)
    expect(handle.type).toBe(`worker`)
    expect(handle.db).toBe(childDb)
    expect(typeof handle.send).toBe(`function`)
    expect(typeof handle.status).toBe(`function`)
  })

  it(`child.run throws during setup() with guidance to use effects`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    expect(() => handle.run).toThrow(
      `child.run cannot be called during setup() — use them in effects instead`
    )
  })

  it(`child.send() throws during setup() with guidance to use effects`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    expect(() => handle.send({ text: `hello` })).toThrow(
      `child.send() cannot be called during setup() — use them in effects instead`
    )
  })

  it(`child.run returns a Promise after setup is complete`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    ctx.setInSetup(false)
    const runPromise = handle.run
    expect(runPromise).toBeInstanceOf(Promise)
  })

  it(`child.send() pushes to pendingSends after setup is complete`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    ctx.setInSetup(false)
    handle.send({ text: `hello` })
    const sends = ctx.getPendingSends()
    expect(sends).toContainEqual({
      targetUrl: `/worker/w-1`,
      payload: { text: `hello` },
    })
  })

  it(`child.send resets run promise — getter returns a NEW promise after send`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    ctx.setInSetup(false)

    const firstRun = handle.run
    expect(firstRun).toBeInstanceOf(Promise)

    handle.send({ text: `do work` })

    const secondRun = handle.run
    expect(secondRun).toBeInstanceOf(Promise)
    expect(secondRun).not.toBe(firstRun)
  })

  it(`updateEntityUrl changes handle.entityUrl and send targetUrl`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    const handleInfo = spawnHandles.get(`w-1`)!
    handleInfo.wireDb(mockDb())
    const handle = await spawnPromise
    expect(handle.entityUrl).toBe(`/worker/w-1`)

    // processWake would call this after learning the real server URL
    handleInfo.updateEntityUrl(`/worker/real-uuid-123`)

    expect(handle.entityUrl).toBe(`/worker/real-uuid-123`)

    // child.send should use the updated entity id
    ctx.setInSetup(false)
    handle.send({ text: `hello` })
    const sends = ctx.getPendingSends()
    expect(sends).toContainEqual({
      targetUrl: `/worker/real-uuid-123`,
      payload: { text: `hello` },
    })
  })

  it(`resolveRun resolves the child.run promise`, async () => {
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`worker`, `w-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`w-1`)!.wireDb(mockDb())
    const handle = await spawnPromise
    ctx.setInSetup(false)

    const runPromise = handle.run
    let resolved = false
    runPromise.then(() => {
      resolved = true
    })

    // Not yet resolved
    await Promise.resolve()
    expect(resolved).toBe(false)

    // processWake calls resolveRun when child completes
    spawnHandles.get(`w-1`)!.resolveRun()

    await runPromise
    expect(resolved).toBe(true)
  })

  // ====================================================================
  // Shared state stream tests
  // ====================================================================

  const findingsSchema = {
    findings: {
      schema: passthroughSchema,
      type: `finding`,
      primaryKey: `key`,
    },
  }

  it(`mkdb creates a typed shared stream`, async () => {
    const { ctx } = makeCtx()
    const board = ctx.mkdb(`board-1`, findingsSchema)
    expect(board.id).toBe(`board-1`)
    expect(board.findings).toBeDefined()
    await wireSharedState(ctx, findingsSchema)
    board.findings.insert({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found`,
    })
  })

  it(`mkdb registers a shared-state manifest entry with mode=create`, () => {
    const { ctx } = makeCtx()
    ctx.mkdb(`board-1`, findingsSchema)
    const manifest = ctx.getManifest()
    expect(manifest).toContainEqual({
      kind: `shared-state`,
      key: manifestSharedStateKey(`board-1`),
      id: `board-1`,
      mode: `create`,
      collections: {
        findings: {
          type: `finding`,
          primaryKey: `key`,
        },
      },
    })
  })

  it(`observe(db(...)) connects to existing shared stream and reads data`, async () => {
    const { ctx: ctx1 } = makeCtx()
    ctx1.mkdb(`board-1`, findingsSchema)
    await wireSharedState(ctx1, findingsSchema)

    const { ctx: ctx2 } = makeCtx()
    const connected = (await ctx2.observe(
      db(`board-1`, findingsSchema)
    )) as unknown as {
      id: string
      findings: {
        get: (key: string) => Record<string, unknown> | undefined
        insert: (row: Record<string, unknown>) => unknown
        toArray: Array<Record<string, unknown>>
      }
    }
    await wireSharedState(ctx2, findingsSchema, {
      findings: [
        {
          key: `f-1`,
          domain: `security`,
          finding: `Existing shared finding`,
        },
      ],
    })
    expect(connected.id).toBe(`board-1`)
    expect(connected.findings).toBeDefined()
    expect(connected.findings.get(`f-1`)).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `Existing shared finding`,
    })
    expect(connected.findings.toArray).toEqual([
      {
        key: `f-1`,
        domain: `security`,
        finding: `Existing shared finding`,
      },
    ])
    connected.findings.insert({
      key: `f-2`,
      domain: `infra`,
      finding: `Open port 22`,
    })
  })

  it(`observe(db(...)) does not allow reads or writes before the shared DB is wired`, async () => {
    const { ctx } = makeCtx()
    const connected = (await ctx.observe(
      db(`board-1`, findingsSchema)
    )) as unknown as {
      findings: {
        get: (key: string) => Record<string, unknown> | undefined
        insert: (row: Record<string, unknown>) => unknown
        toArray: Array<Record<string, unknown>>
      }
    }

    expect(() => connected.findings.get(`f-1`)).toThrow(
      `shared DB "board-1" is not loaded yet`
    )
    expect(() => connected.findings.toArray).toThrow(
      `shared DB "board-1" is not loaded yet`
    )
    expect(() =>
      connected.findings.insert({
        key: `f-1`,
        domain: `security`,
        finding: `Should not stage before load`,
      })
    ).toThrow(`shared DB "board-1" is not loaded yet`)
  })

  it(`observe(db(...)) registers a source manifest entry`, async () => {
    const { ctx } = makeCtx()
    await ctx.observe(db(`board-1`, findingsSchema))
    const manifest = ctx.getManifest()
    expect(manifest).toContainEqual(
      expect.objectContaining({
        kind: `source`,
        sourceType: `db`,
        sourceRef: `board-1`,
      })
    )
  })

  it(`shared state handle provides insert/update/delete/get/toArray`, async () => {
    const { ctx } = makeCtx()
    const board = ctx.mkdb(`board-1`, findingsSchema)
    await wireSharedState(ctx, findingsSchema)

    // insert
    const tx = board.findings.insert({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found`,
    })
    expect(tx).toHaveProperty(`isPersisted`)

    // get
    const row = board.findings.get(`f-1`)
    expect(row).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found`,
    })

    // toArray
    expect(board.findings.toArray).toHaveLength(1)

    // update
    board.findings.update(`f-1`, (draft) => {
      draft.finding = `XSS found (critical)`
    })
    expect(board.findings.get(`f-1`)).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found (critical)`,
    })

    // delete
    board.findings.delete(`f-1`)
    expect(board.findings.get(`f-1`)).toBeUndefined()
    expect(board.findings.toArray).toHaveLength(0)
  })

  it(`shared state handle get returns undefined for missing key`, () => {
    const { ctx } = makeCtx()
    const board = ctx.mkdb(`board-1`, findingsSchema)
    expect(board.findings.get(`nonexistent`)).toBeUndefined()
  })

  it(`shared state with multiple collections`, async () => {
    const { ctx } = makeCtx()
    const multiSchema = {
      arguments: {
        schema: passthroughSchema,
        type: `argument`,
        primaryKey: `key`,
      },
      votes: {
        schema: passthroughSchema,
        type: `vote`,
        primaryKey: `key`,
      },
    }
    const arena = ctx.mkdb(`debate-1`, multiSchema)
    await wireSharedState(ctx, multiSchema)
    expect(arena.id).toBe(`debate-1`)
    expect(arena.arguments).toBeDefined()
    expect(arena.votes).toBeDefined()

    arena.arguments.insert({ key: `a-1`, claim: `TypeScript is superior` })
    arena.votes.insert({ key: `v-1`, argument_id: `a-1`, voter: `entity-2` })

    expect(arena.arguments.toArray).toHaveLength(1)
    expect(arena.votes.toArray).toHaveLength(1)
  })

  it(`mkdb throws on duplicate shared DB`, () => {
    const { ctx } = makeCtx()
    ctx.mkdb(`board-1`, findingsSchema)
    expect(() => ctx.mkdb(`board-1`, findingsSchema)).toThrow(
      `shared DB "board-1" already exists`
    )
  })

  it(`observe(db(...)) is idempotent — returns same handle on repeat calls`, async () => {
    const { ctx } = makeCtx()
    ctx.mkdb(`board-1`, findingsSchema)
    const handle1 = await ctx.observe(db(`board-1`, findingsSchema))
    const handle2 = await ctx.observe(db(`board-1`, findingsSchema))
    expect(handle1).toBe(handle2)
  })

  it(`shared state mutations stay visible before wiring and replay into the backing db once wired`, async () => {
    const { ctx } = makeCtx()
    const board = ctx.mkdb(`board-1`, findingsSchema)

    board.findings.insert({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found`,
    })
    board.findings.update(`f-1`, (draft) => {
      draft.finding = `XSS found (critical)`
    })

    expect(board.findings.get(`f-1`)).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found (critical)`,
    })
    expect(board.findings.toArray).toEqual([
      {
        key: `f-1`,
        domain: `security`,
        finding: `XSS found (critical)`,
      },
    ])

    await wireSharedState(ctx, findingsSchema)

    expect(board.findings.get(`f-1`)).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `XSS found (critical)`,
    })
    expect(board.findings.toArray).toEqual([
      {
        key: `f-1`,
        domain: `security`,
        finding: `XSS found (critical)`,
      },
    ])

    board.findings.delete(`f-1`)
    expect(board.findings.get(`f-1`)).toBeUndefined()
    expect(board.findings.toArray).toEqual([])
  })

  it(`restorePersistedSharedStateHandles rebuilds handles from manifest rows`, async () => {
    const { ctx } = makeCtx([], {
      manifests: [
        {
          kind: `shared-state`,
          key: manifestSharedStateKey(`board-1`),
          id: `board-1`,
          mode: `connect`,
          collections: {
            findings: {
              type: `finding`,
              primaryKey: `key`,
            },
          },
        },
      ],
    })

    ctx.restorePersistedSharedStateHandles()
    ctx.restorePersistedSharedStateHandles()

    const restored = ctx.getSharedStateHandles().get(`board-1`)
    expect(restored).toBeDefined()
    expect(restored?.mode).toBe(`connect`)
    expect(Object.keys(restored?.schema ?? {})).toEqual([`findings`])
    expect(ctx.getSharedStateHandles().size).toBe(1)

    await wireSharedState(ctx, findingsSchema, {
      findings: [
        {
          key: `f-1`,
          domain: `security`,
          finding: `Restored from shared state stream`,
        },
      ],
    })

    const board = restored!.handle as unknown as {
      findings: {
        get: (key: string) => Record<string, unknown> | undefined
        toArray: Array<Record<string, unknown>>
      }
    }
    expect(board.findings.get(`f-1`)).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `Restored from shared state stream`,
    })
    expect(board.findings.toArray).toEqual([
      {
        key: `f-1`,
        domain: `security`,
        finding: `Restored from shared state stream`,
      },
    ])
  })

  it(`observe(db(...)) after restore returns the rebuilt handle instead of throwing`, async () => {
    const { ctx } = makeCtx([], {
      manifests: [
        {
          kind: `shared-state`,
          key: manifestSharedStateKey(`board-1`),
          id: `board-1`,
          mode: `connect`,
          collections: {
            findings: {
              type: `finding`,
              primaryKey: `key`,
            },
          },
        },
      ],
    })

    ctx.restorePersistedSharedStateHandles()

    const restored = ctx.getSharedStateHandles().get(`board-1`)!.handle
    const observed = await ctx.observe(db(`board-1`, findingsSchema))

    await wireSharedState(ctx, findingsSchema, {
      findings: [
        {
          key: `f-1`,
          domain: `security`,
          finding: `Observed after restore`,
        },
      ],
    })

    expect(observed).toBe(restored)
    expect(
      (
        observed as unknown as {
          findings: {
            get: (key: string) => Record<string, unknown> | undefined
          }
        }
      ).findings.get(`f-1`)
    ).toEqual({
      key: `f-1`,
      domain: `security`,
      finding: `Observed after restore`,
    })
  })
})

// ============================================================================
// Entity pattern integration tests
// Like the Liahona guiding through the wilderness, each pattern exercises a
// specific axis of the runtime API: state, agents, schemas, shared state,
// spawn handles, effects, and triggers.
// ============================================================================

describe(`entity patterns`, () => {
  interface MockCollection {
    has: (key: string) => boolean
    id: string
    toArray: Array<Record<string, unknown>>
    get: (key: string) => Record<string, unknown> | undefined
    insert: (value: Record<string, unknown>) => unknown
    update: (
      key: string,
      updater: (draft: Record<string, unknown>) => void
    ) => unknown
    delete: (key: string) => unknown
    utils: {
      acceptMutations: (transaction: {
        mutations: Array<{ collection: { id: string } }>
      }) => void
    }
  }

  function createMockCollection(rows: Array<unknown>): MockCollection {
    return createLocalOnlyTestCollection(
      rows as Array<Record<string, unknown>>
    ) as unknown as MockCollection
  }

  function createMockWriteTransaction(
    collections: Record<string, MockCollection>
  ) {
    return (opts?: { autoCommit?: boolean }) => {
      const transaction = createTransaction<Record<string, unknown>>({
        autoCommit: opts?.autoCommit ?? true,
        mutationFn: async ({ transaction }) => {
          for (const collection of Object.values(collections)) {
            collection.utils.acceptMutations(transaction)
          }
        },
      })
      void transaction.isPersisted.promise.catch(() => undefined)
      return transaction
    }
  }

  function mockDb(
    overrides: Partial<Record<string, Array<unknown>>> = {},
    awaitTxId: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
    actions: Record<string, ReturnType<typeof vi.fn>> = {}
  ): EntityStreamDBWithActions {
    const collections: Record<string, MockCollection> = {}
    for (const [name] of Object.entries(ENTITY_COLLECTIONS)) {
      collections[name] = createMockCollection(overrides[name] ?? [])
    }
    for (const name of Object.keys(overrides)) {
      if (!collections[name]) {
        collections[name] = createMockCollection(overrides[name] ?? [])
      }
    }
    const createWriteTransaction = createMockWriteTransaction(collections)
    return {
      collections,
      close: () => {},
      utils: {
        awaitTxId,
        createWriteTransaction,
        awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
        applyEvent: () => createWriteTransaction(),
      },
      actions,
    } as unknown as EntityStreamDBWithActions
  }

  function makeCtx(
    events: Array<ChangeEvent> = [],
    dbOverrides: Partial<Record<string, Array<unknown>>> = {},
    effectScope?: any,
    args: Record<string, unknown> = {},
    customStateNames: Array<string> = [],
    actions: Record<string, ReturnType<typeof vi.fn>> = {}
  ) {
    effectScope ??= {
      register: vi.fn(),
      disposeAll: vi.fn().mockResolvedValue(undefined),
    } as never
    const writes: Array<unknown> = []
    const awaitTxId = vi.fn().mockResolvedValue(undefined)
    const db = mockDb(dbOverrides, awaitTxId, actions)
    return {
      ctx: createSetupContext({
        entityUrl: `test-entity-1`,
        entityType: `test-agent`,
        args: Object.freeze(args),
        db,
        events,
        writeEvent: (e: ChangeEvent) => {
          writes.push(e)
        },
        serverBaseUrl: `http://localhost:3000`,
        effectScope,
        customStateNames,
      }),
      db,
      writes,
      awaitTxId,
    }
  }

  function mockSharedStateDb2(
    schema: SharedStateSchemaMap
  ): EntityStreamDBWithActions {
    const collections: Record<string, MockCollection> = {}
    const actions: Record<string, (...args: Array<unknown>) => unknown> = {}
    for (const [collName, collSchema] of Object.entries(schema)) {
      const pk = collSchema.primaryKey
      const coll = createLocalOnlyTestCollection<Record<string, unknown>>([], {
        getKey: (row) => {
          const key = row[pk]
          if (typeof key === `string` || typeof key === `number`) {
            return String(key)
          }
          throw new Error(
            `Shared-state mock row for "${collName}" is missing primary key "${pk}"`
          )
        },
      }) as unknown as MockCollection
      collections[collName] = coll
      actions[`${collName}_insert`] = ((arg: unknown) => {
        const { row } = arg as { row: Record<string, unknown> }
        coll.insert(row)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [],
        }
      }) as (...args: Array<unknown>) => unknown
      actions[`${collName}_update`] = ((arg: unknown) => {
        const { key, updater } = arg as {
          key: string
          updater: (draft: Record<string, unknown>) => void
        }
        coll.update(key, updater)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [],
        }
      }) as (...args: Array<unknown>) => unknown
      actions[`${collName}_delete`] = ((arg: unknown) => {
        const { key } = arg as { key: string }
        coll.delete(key)
        return {
          isPersisted: { promise: Promise.resolve() },
          state: `pending`,
          mutations: [],
        }
      }) as (...args: Array<unknown>) => unknown
    }
    const createWriteTransaction = createMockWriteTransaction(collections)
    return {
      collections,
      close: () => {},
      utils: {
        awaitTxId: vi.fn().mockResolvedValue(undefined),
        awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
        createWriteTransaction,
      },
      actions,
    } as unknown as EntityStreamDBWithActions
  }

  async function wireSharedState2(
    ctx: SetupContextResult,
    schema: SharedStateSchemaMap
  ): Promise<void> {
    for (const [, handle] of ctx.getSharedStateHandles()) {
      await handle.wireDb(mockSharedStateDb2(schema))
    }
  }

  // ----------------------------------------------------------------
  // Pattern 1: Counter — state: declaration, effect-driven CRUD
  // ----------------------------------------------------------------

  it(`Pattern 1 (Counter): state proxy insert/update on counts collection`, () => {
    const insertAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })
    const updateAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })

    const { ctx } = makeCtx(
      [],
      { counts: [{ key: `total`, value: 0 }] },
      undefined,
      {},
      [`counts`],
      {
        counts_insert: insertAction,
        counts_update: updateAction,
        counts_delete: vi.fn(),
      }
    )

    // Entity definition has state: { counts: {} } — ctx.state.counts is live
    expect(ctx.state.counts).toBeDefined()
    expect(ctx.state.counts!.get(`total`)).toEqual({ key: `total`, value: 0 })

    // Effect-driven write: insert a new counter row
    const tx = ctx.state.counts!.insert({ key: `session`, value: 1 })
    expect(insertAction).toHaveBeenCalledWith({
      row: { key: `session`, value: 1 },
    })
    expect(tx).toHaveProperty(`isPersisted`)

    // Effect-driven write: increment existing counter
    const updater = (draft: Record<string, unknown>) => {
      draft.value = (draft.value as number) + 1
    }
    ctx.state.counts!.update(`total`, updater)
    expect(updateAction).toHaveBeenCalledWith({ key: `total`, updater })

    // No custom actions registered — ctx.actions is empty
    expect(Object.keys(ctx.actions)).toHaveLength(0)
  })

  it(`Pattern 1 (Counter): state toArray reflects seed data`, () => {
    const { ctx } = makeCtx(
      [],
      {
        counts: [
          { key: `a`, value: 10 },
          { key: `b`, value: 20 },
        ],
      },
      undefined,
      {},
      [`counts`],
      {
        counts_insert: vi.fn(),
        counts_update: vi.fn(),
        counts_delete: vi.fn(),
      }
    )

    const arr = ctx.state.counts!.toArray
    expect(arr).toHaveLength(2)
    expect(arr[0]).toEqual({ key: `a`, value: 10 })
    expect(arr[1]).toEqual({ key: `b`, value: 20 })
  })

  it(`Pattern 2 (Chat Agent): empty entities expose no state or actions`, () => {
    const { ctx } = makeCtx()
    expect(ctx.getManifest()).toEqual([])
    expect(Object.keys(ctx.state)).toHaveLength(0)
    expect(Object.keys(ctx.actions)).toHaveLength(0)
  })

  // ----------------------------------------------------------------
  // Pattern 3: PR Reviewer — creationSchema, inboxSchemas, state + agent
  // ----------------------------------------------------------------

  it(`Pattern 3 (PR Reviewer): args from creationSchema are accessible`, () => {
    // The creationSchema is attached to the EntityDefinition, but at runtime
    // the validated args are passed directly to handleWake as ctx.args.
    const { ctx } = makeCtx(
      [],
      { reviews: [] },
      undefined,
      { prNumber: 42, repo: `electric-sql/durable-streams`, draft: false },
      [`reviews`],
      {
        reviews_insert: vi.fn(),
        reviews_update: vi.fn(),
        reviews_delete: vi.fn(),
      }
    )

    expect(ctx.args.prNumber).toBe(42)
    expect(ctx.args.repo).toBe(`electric-sql/durable-streams`)
    expect(ctx.args.draft).toBe(false)
  })

  it(`Pattern 3 (PR Reviewer): state proxy is wired for reviews collection`, () => {
    const { ctx } = makeCtx(
      [],
      { reviews: [] },
      undefined,
      { prNumber: 1 },
      [`reviews`],
      {
        reviews_insert: vi.fn(),
        reviews_update: vi.fn(),
        reviews_delete: vi.fn(),
      }
    )

    expect(ctx.state.reviews).toBeDefined()
  })

  it(`Pattern 3 (PR Reviewer): state proxy insert records review`, () => {
    const insertAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })

    const { ctx } = makeCtx(
      [],
      { reviews: [] },
      undefined,
      { prNumber: 7 },
      [`reviews`],
      {
        reviews_insert: insertAction,
        reviews_update: vi.fn(),
        reviews_delete: vi.fn(),
      }
    )

    ctx.state.reviews!.insert({ key: `r-1`, comment: `LGTM`, approved: true })
    expect(insertAction).toHaveBeenCalledWith({
      row: { key: `r-1`, comment: `LGTM`, approved: true },
    })
  })

  // ----------------------------------------------------------------
  // Pattern 4: Blackboard — mkdb, observe(db(...)), multi-writer
  // ----------------------------------------------------------------

  it(`Pattern 4 (Blackboard): two entities share a state stream via mkdb/observe(db(...))`, async () => {
    const boardSchema = {
      notes: {
        schema: passthroughSchema,
        type: `note`,
        primaryKey: `key`,
      },
    }

    // Coordinator creates the shared board
    const { ctx: coordinator } = makeCtx()
    const board = coordinator.mkdb(`blackboard-1`, boardSchema)
    await wireSharedState2(coordinator, boardSchema)
    expect(board.id).toBe(`blackboard-1`)

    const coordinatorManifest = coordinator.getManifest()
    expect(coordinatorManifest).toContainEqual({
      kind: `shared-state`,
      key: manifestSharedStateKey(`blackboard-1`),
      id: `blackboard-1`,
      mode: `create`,
      collections: {
        notes: {
          type: `note`,
          primaryKey: `key`,
        },
      },
    })

    // Writer connects to the same board via observe(db(...))
    const { ctx: writer } = makeCtx()
    const writerBoard = (await writer.observe(
      db(`blackboard-1`, boardSchema)
    )) as unknown as {
      notes: {
        insert: (row: Record<string, unknown>) => unknown
        get: (key: string) => Record<string, unknown> | undefined
      }
    }
    await wireSharedState2(writer, boardSchema)

    const writerManifest = writer.getManifest()
    expect(writerManifest).toContainEqual(
      expect.objectContaining({
        kind: `source`,
        sourceType: `db`,
        sourceRef: `blackboard-1`,
      })
    )

    // Both handles can write
    board.notes.insert({ key: `n-1`, text: `Initial hypothesis` })
    writerBoard.notes.insert({ key: `n-2`, text: `Counter-evidence` })

    expect(board.notes.get(`n-1`)).toEqual({
      key: `n-1`,
      text: `Initial hypothesis`,
    })
    expect(writerBoard.notes.get(`n-2`)).toEqual({
      key: `n-2`,
      text: `Counter-evidence`,
    })
  })

  it(`Pattern 4 (Blackboard): shared state handles support full CRUD`, async () => {
    const boardSchema = {
      notes: {
        schema: passthroughSchema,
        type: `note`,
        primaryKey: `key`,
      },
    }

    const { ctx } = makeCtx()
    const board = ctx.mkdb(`blackboard-2`, boardSchema)
    await wireSharedState2(ctx, boardSchema)

    board.notes.insert({ key: `n-1`, text: `Draft` })
    expect(board.notes.toArray).toHaveLength(1)

    board.notes.update(`n-1`, (d) => {
      d.text = `Revised`
    })
    expect(board.notes.get(`n-1`)).toEqual({ key: `n-1`, text: `Revised` })

    board.notes.delete(`n-1`)
    expect(board.notes.toArray).toHaveLength(0)
    expect(board.notes.get(`n-1`)).toBeUndefined()
  })

  // ----------------------------------------------------------------
  // Pattern 5: Deep Research — creationSchema, spawn + child handle
  // ----------------------------------------------------------------

  it(`Pattern 5 (Deep Research): spawn creates child handles with correct types`, async () => {
    const { ctx } = makeCtx([], {}, undefined, { topic: `Nephite geography` })

    const searcherPromise = ctx.spawn(`web-searcher`, `searcher-1`, {
      query: `Nephite geography`,
    })
    const synthPromise = ctx.spawn(`synthesizer`, `synth-1`, {
      topic: `Nephite geography`,
    })

    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`searcher-1`)!.wireDb(mockDb())
    spawnHandles.get(`synth-1`)!.wireDb(mockDb())

    const searcher = await searcherPromise
    const synthesizer = await synthPromise

    expect(searcher.entityUrl).toBe(`/web-searcher/searcher-1`)
    expect(searcher.type).toBe(`web-searcher`)
    expect(synthesizer.entityUrl).toBe(`/synthesizer/synth-1`)
    expect(synthesizer.type).toBe(`synthesizer`)

    const manifest = ctx.getManifest()
    const children = manifest.filter((e) => e.kind === `child`)
    expect(children).toHaveLength(2)
    expect(children[0]).toEqual({
      kind: `child`,
      key: manifestChildKey(`web-searcher`, `searcher-1`),
      id: `searcher-1`,
      entity_type: `web-searcher`,
      entity_url: `/web-searcher/searcher-1`,
      observed: true,
    })
    expect(children[1]).toEqual({
      kind: `child`,
      key: manifestChildKey(`synthesizer`, `synth-1`),
      id: `synth-1`,
      entity_type: `synthesizer`,
      entity_url: `/synthesizer/synth-1`,
      observed: true,
    })
  })

  it(`Pattern 5 (Deep Research): each spawn marks the child manifest row as observed`, async () => {
    const { ctx } = makeCtx([], {}, undefined, { topic: `Liahona symbolism` })

    const p1 = ctx.spawn(`web-searcher`, `searcher-1`)
    const p2 = ctx.spawn(`web-searcher`, `searcher-2`)

    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`searcher-1`)!.wireDb(mockDb())
    spawnHandles.get(`searcher-2`)!.wireDb(mockDb())
    await p1
    await p2

    const manifest = ctx.getManifest()
    const children = manifest.filter((e) => e.kind === `child`)
    expect(children).toHaveLength(2)
    expect(children.map((child) => child.observed)).toEqual([true, true])
  })

  it(`Pattern 5 (Deep Research): args from creationSchema drive child spawn args`, async () => {
    const { ctx } = makeCtx([], {}, undefined, {
      topic: `Translation of the Book of Mormon`,
      depth: 3,
    })

    // Simulate setup() reading args and forwarding to children
    const topic = ctx.args.topic as string
    const depth = ctx.args.depth as number

    const spawnPromise = ctx.spawn(`sub-researcher`, `sub-1`, { topic, depth })
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`sub-1`)!.wireDb(mockDb())
    await spawnPromise
    const manifest = ctx.getManifest()
    const childEntry = manifest.find((e) => e.kind === `child`)
    expect(childEntry).toMatchObject({
      kind: `child`,
      entity_type: `sub-researcher`,
      entity_url: `/sub-researcher/sub-1`,
      observed: true,
    })
  })

  // ----------------------------------------------------------------
  // Pattern 6: Debate Arena — mkdb with typed schema, spawn debaters
  // ----------------------------------------------------------------

  it(`Pattern 6 (Debate Arena): shared state with typed schema + spawn debaters`, async () => {
    const arenaSchema = {
      arguments: {
        schema: passthroughSchema,
        type: `argument`,
        primaryKey: `key`,
      },
      votes: {
        schema: passthroughSchema,
        type: `vote`,
        primaryKey: `key`,
      },
    }

    const { ctx } = makeCtx([], {}, undefined, { topic: `Sword of Laban` })

    const arena = ctx.mkdb(`arena-1`, arenaSchema)
    await wireSharedState2(ctx, arenaSchema)
    expect(arena.id).toBe(`arena-1`)
    expect(arena.arguments).toBeDefined()
    expect(arena.votes).toBeDefined()

    // Spawn two debaters, each connecting to the arena
    const d1Promise = ctx.spawn(`debater`, `debater-1`, { position: `pro` })
    const d2Promise = ctx.spawn(`debater`, `debater-2`, { position: `con` })

    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`debater-1`)!.wireDb(mockDb())
    spawnHandles.get(`debater-2`)!.wireDb(mockDb())

    const debater1 = await d1Promise
    const debater2 = await d2Promise

    const manifest = ctx.getManifest()
    const children = manifest.filter((e) => e.kind === `child`)
    const sharedState = manifest.find((e) => e.kind === `shared-state`)

    expect(children).toHaveLength(2)
    expect(sharedState).toEqual({
      kind: `shared-state`,
      key: manifestSharedStateKey(`arena-1`),
      id: `arena-1`,
      mode: `create`,
      collections: {
        arguments: {
          type: `argument`,
          primaryKey: `key`,
        },
        votes: {
          type: `vote`,
          primaryKey: `key`,
        },
      },
    })

    // Arena accepts argument inserts
    arena.arguments.insert({
      key: `arg-1`,
      debater: debater1.entityUrl,
      claim: `The sword is symbolic`,
    })
    arena.votes.insert({
      key: `v-1`,
      argument_id: `arg-1`,
      voter: debater2.entityUrl,
    })

    expect(arena.arguments.toArray).toHaveLength(1)
    expect(arena.votes.toArray).toHaveLength(1)
  })

  // ----------------------------------------------------------------
  // Pattern 7: Tree of Thoughts — child.send() + child.run re-promise
  // ----------------------------------------------------------------

  it(`Pattern 7 (Tree of Thoughts): child.run and child.send work after setup completes`, async () => {
    const { ctx } = makeCtx()
    const branchPromise = ctx.spawn(`thought-branch`, `branch-1`)
    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`branch-1`)!.wireDb(mockDb())
    const branch = await branchPromise

    // During setup, run/send throw
    expect(() => branch.run).toThrow(
      `child.run cannot be called during setup()`
    )
    expect(() => branch.send({ explore: `path A` })).toThrow(
      `child.send() cannot be called during setup()`
    )

    // After setup completes
    ctx.setInSetup(false)

    const run1 = branch.run
    expect(run1).toBeInstanceOf(Promise)

    branch.send({ explore: `path A` })

    // After send, run is a NEW promise
    const run2 = branch.run
    expect(run2).toBeInstanceOf(Promise)
    expect(run2).not.toBe(run1)
  })

  it(`Pattern 7 (Tree of Thoughts): sends accumulate in pendingSends`, async () => {
    const { ctx } = makeCtx()
    const b1Promise = ctx.spawn(`thought-branch`, `branch-1`)
    const b2Promise = ctx.spawn(`thought-branch`, `branch-2`)

    const spawnHandles = ctx.getSpawnHandles()
    spawnHandles.get(`branch-1`)!.wireDb(mockDb())
    spawnHandles.get(`branch-2`)!.wireDb(mockDb())

    const branch1 = await b1Promise
    const branch2 = await b2Promise

    ctx.setInSetup(false)

    branch1.send({ explore: `path A` })
    branch1.send({ explore: `path B` })
    branch2.send({ explore: `path C` })

    const sends = ctx.getPendingSends()
    expect(sends).toHaveLength(3)
    expect(sends[0]).toEqual({
      targetUrl: `/thought-branch/branch-1`,
      payload: { explore: `path A` },
    })
    expect(sends[1]).toEqual({
      targetUrl: `/thought-branch/branch-1`,
      payload: { explore: `path B` },
    })
    expect(sends[2]).toEqual({
      targetUrl: `/thought-branch/branch-2`,
      payload: { explore: `path C` },
    })
  })

  // ----------------------------------------------------------------
  // Pattern 8: Contract Net — two entity types, state, inboxSchemas, negotiation
  // ----------------------------------------------------------------

  it(`Pattern 8 (Contract Net): contractor state proxy with bid tracking`, () => {
    const insertAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })
    const updateAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })

    // Contractor entity with state: { bids: {}, awards: {} }
    const { ctx } = makeCtx(
      [],
      {
        bids: [{ key: `bid-0`, amount: 100, status: `open` }],
        awards: [],
      },
      undefined,
      { contractorId: `contractor-42` },
      [`bids`, `awards`],
      {
        bids_insert: insertAction,
        bids_update: updateAction,
        bids_delete: vi.fn(),
        awards_insert: vi.fn(),
        awards_update: vi.fn(),
        awards_delete: vi.fn(),
      }
    )

    expect(ctx.args.contractorId).toBe(`contractor-42`)

    // Read existing bid via state proxy
    const existingBid = ctx.state.bids!.get(`bid-0`)
    expect(existingBid).toEqual({ key: `bid-0`, amount: 100, status: `open` })

    // Negotiation: insert new bid
    ctx.state.bids!.insert({
      key: `bid-1`,
      amount: 95,
      status: `pending`,
    })
    expect(insertAction).toHaveBeenCalledWith({
      row: { key: `bid-1`, amount: 95, status: `pending` },
    })

    // Accept: update bid status
    ctx.state.bids!.update(`bid-0`, (d) => {
      d.status = `accepted`
    })
    expect(updateAction).toHaveBeenCalledWith({
      key: `bid-0`,
      updater: expect.any(Function),
    })
  })

  it(`Pattern 8 (Contract Net): custom acceptBid action exposed on ctx.actions`, () => {
    const mockTx = {
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    }
    const acceptBid = vi.fn().mockReturnValue(mockTx)

    const { ctx } = makeCtx(
      [],
      { bids: [], awards: [] },
      undefined,
      {},
      [`bids`, `awards`],
      {
        bids_insert: vi.fn(),
        bids_update: vi.fn(),
        bids_delete: vi.fn(),
        awards_insert: vi.fn(),
        awards_update: vi.fn(),
        awards_delete: vi.fn(),
        acceptBid,
      }
    )

    // Custom action available, CRUD actions hidden
    expect(ctx.actions.acceptBid).toBeDefined()
    expect(ctx.actions.bids_insert).toBeUndefined()
    expect(ctx.actions.awards_insert).toBeUndefined()

    const tx = ctx.actions.acceptBid!(`bid-1`)
    expect(acceptBid).toHaveBeenCalledWith(`bid-1`)
    expect(tx).toBe(mockTx)
  })

  // ----------------------------------------------------------------
  // Pattern 9: Pub-Sub Channel — observe peer, send, effect
  // ----------------------------------------------------------------

  it(`Pattern 9 (Pub-Sub): observe registers manifest entry`, async () => {
    const { ctx } = makeCtx()
    const peerPromise = ctx.observe(entity(`channel-upstream`))
    const manifest = ctx.getManifest()
    expect(manifest).toContainEqual({
      kind: `source`,
      key: manifestSourceKey(`entity`, `channel-upstream`),
      sourceType: `entity`,
      sourceRef: `channel-upstream`,
      config: { entityUrl: `channel-upstream` },
    })
    // Resolve the observe handle by wiring the db
    const observeHandles = ctx.getSourceHandles()
    const observeHandle = observeHandles.get(`channel-upstream`)
    observeHandle?.wireDb?.(mockDb())
    const peer = await peerPromise
    expect(peer.sourceRef).toBe(`channel-upstream`)
  })

  it(`Pattern 9 (Pub-Sub): send accumulates pending sends with type`, () => {
    const { ctx } = makeCtx()
    ctx.setInSetup(false)
    ctx.send(
      `subscriber-1`,
      { topic: `zion`, data: `verse 1` },
      { type: `publication` }
    )
    ctx.send(
      `subscriber-2`,
      { topic: `zion`, data: `verse 1` },
      { type: `publication` }
    )

    const sends = ctx.getPendingSends()
    expect(sends).toHaveLength(2)
    expect(sends[0]).toEqual({
      targetUrl: `subscriber-1`,
      payload: { topic: `zion`, data: `verse 1` },
      type: `publication`,
    })
    expect(sends[1]).toEqual({
      targetUrl: `subscriber-2`,
      payload: { topic: `zion`, data: `verse 1` },
      type: `publication`,
    })
  })

  it(`Pattern 9 (Pub-Sub): createEffect registers effect in manifest`, () => {
    const { ctx } = makeCtx()

    const created = ctx.createEffect(`watch-inbox`, `inbox-0`, {
      collection: `inbox`,
    })

    expect(created).toBe(true)
    const manifest = ctx.getManifest()
    const effectEntry = manifest.find((e) => e.kind === `effect`)
    expect(effectEntry).toBeDefined()
    expect(effectEntry?.key).toBe(manifestEffectKey(`watch-inbox`, `inbox-0`))
  })

  it(`Pattern 9 (Pub-Sub): multiple effects get distinct manifest keys`, () => {
    const { ctx } = makeCtx()

    ctx.createEffect(`watch-inbox`, `inbox-0`, { collection: `inbox` })
    ctx.createEffect(`watch-inbox`, `inbox-1`, { collection: `inbox` })

    const manifest = ctx.getManifest()
    const effectKeys = manifest
      .filter((e) => e.kind === `effect`)
      .map((e) => e.key)
    expect(effectKeys).toEqual([
      manifestEffectKey(`watch-inbox`, `inbox-0`),
      manifestEffectKey(`watch-inbox`, `inbox-1`),
    ])
  })

  // ----------------------------------------------------------------
  // Pattern 10: Metrics Digest — state observations and schedule args
  // ----------------------------------------------------------------

  it(`Pattern 10 (Metrics Digest): args for schedule and state writes coexist`, () => {
    const insertAction = vi.fn().mockReturnValue({
      isPersisted: { promise: Promise.resolve() },
      state: `pending`,
      mutations: [],
    })

    // Metrics digest entity: args carry the cron schedule config,
    // state holds digest records, agent generates the summary.
    const { ctx } = makeCtx(
      [],
      { digests: [] },
      undefined,
      { schedule: `0 9 * * 1`, timezone: `America/Denver` },
      [`digests`],
      {
        digests_insert: insertAction,
        digests_update: vi.fn(),
        digests_delete: vi.fn(),
      }
    )

    expect(ctx.args.schedule).toBe(`0 9 * * 1`)
    expect(ctx.args.timezone).toBe(`America/Denver`)

    // Insert a digest record
    ctx.state.digests!.insert({
      key: `digest-2024-01`,
      period: `2024-01`,
      summary: `All systems nominal`,
    })
    expect(insertAction).toHaveBeenCalledWith({
      row: {
        key: `digest-2024-01`,
        period: `2024-01`,
        summary: `All systems nominal`,
      },
    })
  })

  it(`Pattern 10 (Metrics Digest): observe + state + effect registrations coexist`, () => {
    const effectScope = {
      register: vi.fn(),
      disposeAll: vi.fn().mockResolvedValue(undefined),
    } as never

    const { ctx } = makeCtx(
      [],
      { digests: [] },
      effectScope,
      { schedule: `0 9 * * 1` },
      [`digests`],
      {
        digests_insert: vi.fn(),
        digests_update: vi.fn(),
        digests_delete: vi.fn(),
      }
    )

    ctx.observe(entity(`metrics-source-1`))
    ctx.observe(entity(`metrics-source-2`))
    ctx.createEffect(`watch-inbox`, `inbox-0`, { collection: `inbox` })

    const manifest = ctx.getManifest()
    const kinds = manifest.map((e) => e.kind).sort()
    expect(kinds).toEqual([`effect`, `source`, `source`])
  })

  // =========================================================================
  // Dynamic spawn/observe from tools (post-setup, active phase)
  // =========================================================================

  it(`active-phase spawn stages a child manifest row before completion`, async () => {
    const { createWakeSession } = await import(`../src/wake-session`)
    const db = mockDb()
    const ws = createWakeSession(db)
    const writes: Array<unknown> = []
    const ctx2 = createSetupContext({
      entityUrl: `test-dyn-spawn`,
      entityType: `test-agent`,
      args: Object.freeze({}),
      db,
      events: [],
      writeEvent: (e: ChangeEvent) => {
        writes.push(e)
      },
      serverBaseUrl: `http://localhost:3000`,
      effectScope: {
        register: vi.fn(),
        activateAll: vi.fn(),
        disposeAll: vi.fn().mockResolvedValue(undefined),
      } as never,
      customStateNames: [],
      wakeSession: ws,
    })

    ws.finishSetup()
    ctx2.setInSetup(false)
    const spawnPromise = ctx2.spawn(`worker`, `dyn-child-1`, {
      systemPrompt: `test`,
    })
    const handleInfo = ws.getSpawnHandles().get(`dyn-child-1`)
    const childRow = await queryOnce((q) =>
      q
        .from({ manifests: db.collections.manifests })
        .where(({ manifests }) =>
          eq(manifests.key, manifestChildKey(`worker`, `dyn-child-1`))
        )
        .findOne()
    )
    expect(handleInfo).toBeTruthy()
    expect(childRow).toMatchObject({
      kind: `child`,
      entity_url: `/worker/dyn-child-1`,
      observed: true,
    })

    handleInfo!.wireDb(mockDb())
    const handle = await spawnPromise

    expect(handle.entityUrl).toContain(`dyn-child-1`)
  }, 5000)

  it(`active-phase observe stages an observe manifest row before completion`, async () => {
    const { createWakeSession } = await import(`../src/wake-session`)
    const db = mockDb()
    const ws = createWakeSession(db)
    const ctx2 = createSetupContext({
      entityUrl: `test-dyn-observe`,
      entityType: `test-agent`,
      args: Object.freeze({}),
      db,
      events: [],
      writeEvent: () => {},
      serverBaseUrl: `http://localhost:3000`,
      effectScope: {
        register: vi.fn(),
        activateAll: vi.fn(),
        disposeAll: vi.fn().mockResolvedValue(undefined),
      } as never,
      customStateNames: [],
      wakeSession: ws,
    })

    ws.finishSetup()
    ctx2.setInSetup(false)
    const observePromise = ctx2.observe(entity(`/some/entity`))
    const handleInfo = ws.getSourceHandles().get(`/some/entity`)
    const observeRow = await queryOnce((q) =>
      q
        .from({ manifests: db.collections.manifests })
        .where(({ manifests }) =>
          eq(manifests.key, manifestSourceKey(`entity`, `/some/entity`))
        )
        .findOne()
    )
    expect(handleInfo).toBeTruthy()
    expect(observeRow).toMatchObject({
      kind: `source`,
      sourceType: `entity`,
      sourceRef: `/some/entity`,
      config: { entityUrl: `/some/entity` },
    })

    handleInfo!.wireDb!(mockDb())
    const handle = await observePromise

    expect(handle.sourceRef).toBe(`/some/entity`)
  }, 5000)

  it(`inline observe derives the entity main stream path locally`, async () => {
    const createChildDb = vi.fn(async () => mockDb())
    const ctx = createSetupContext({
      entityUrl: `test-inline-observe`,
      entityType: `test-agent`,
      args: Object.freeze({}),
      db: mockDb(),
      events: [],
      writeEvent: () => {},
      serverBaseUrl: `http://localhost:3000`,
      effectScope: {
        register: vi.fn(),
        activateAll: vi.fn(),
        disposeAll: vi.fn().mockResolvedValue(undefined),
      } as never,
      customStateNames: [],
      wiring: {
        createOrGetChild: vi.fn(),
        createChildDb,
        createSourceDb: vi.fn(),
        createSharedStateDb: vi.fn(),
      },
    })

    await ctx.observe(entity(`/child/example`))

    expect(createChildDb).toHaveBeenCalledWith(
      `http://localhost:3000/child/example/main`,
      `child`,
      expect.any(Function),
      { preload: true }
    )
  })

  it(`text() returns one string per completed run`, async () => {
    // Simulate a child entity that had two runs, each producing text
    const childCollections: Record<string, MockCollection> = {
      ...Object.fromEntries(
        Object.keys(ENTITY_COLLECTIONS).map((k) => [
          k,
          createMockCollection([]),
        ])
      ),
      runs: createMockCollection([
        { key: `run-0`, status: `completed` },
        { key: `run-1`, status: `completed` },
      ]),
      texts: createMockCollection([
        { key: `msg-0`, status: `completed` },
        { key: `msg-1`, status: `completed` },
      ]),
      textDeltas: createMockCollection([
        { key: `msg-0:0`, text_id: `msg-0`, run_id: `run-0`, delta: `Hello ` },
        { key: `msg-0:1`, text_id: `msg-0`, run_id: `run-0`, delta: `world` },
        { key: `msg-1:0`, text_id: `msg-1`, run_id: `run-1`, delta: `Second ` },
        { key: `msg-1:1`, text_id: `msg-1`, run_id: `run-1`, delta: `run` },
      ]),
    }

    const childDb = {
      collections: childCollections,
    } as unknown as EntityStreamDBWithActions

    // Spawn the child and immediately wire its DB via the deferred handle callback
    const { ctx } = makeCtx()
    const spawnPromise = ctx.spawn(`child`, `c1`)

    // Wire the child DB before the spawn promise resolves
    const spawnHandles = ctx.getSpawnHandles()
    const handleInfo = spawnHandles.get(`c1`)
    handleInfo?.wireDb(childDb)
    handleInfo?.resolveRun()

    const child = await spawnPromise
    ctx.setInSetup(false)
    const texts = await child.text()

    // Should return one string per run, not all texts concatenated
    expect(texts).toEqual([`Hello world`, `Second run`])
  })

  // ====================================================================
  // Third-party ObservationSource extensibility
  // ====================================================================

  it(`wake-only custom source registers manifest and source handle`, async () => {
    const heartbeatSource: ObservationSource = {
      sourceType: `heartbeat`,
      sourceRef: `5s`,
      wake() {
        return {
          sourceUrl: `/_heartbeat/5s`,
          condition: { on: `change` as const },
        }
      },
      toManifestEntry() {
        return {
          key: `source:heartbeat:5s`,
          kind: `source` as const,
          sourceType: `heartbeat`,
          sourceRef: `5s`,
          config: { intervalMs: 5000 },
        }
      },
    }

    const { ctx } = makeCtx()
    const handle = await ctx.observe(heartbeatSource)

    expect(handle.sourceType).toBe(`heartbeat`)
    expect(handle.sourceRef).toBe(`5s`)
    expect(handle.db).toBeUndefined()
    expect(handle.events).toEqual([])

    const manifest = ctx.getManifest()
    const entry = manifest.find(
      (m) => m.kind === `source` && m.sourceType === `heartbeat`
    )
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({
      kind: `source`,
      sourceType: `heartbeat`,
      sourceRef: `5s`,
      config: { intervalMs: 5000 },
    })

    const sourceHandles = ctx.getSourceHandles()
    expect(sourceHandles.has(`5s`)).toBe(true)
  })

  it(`cron source registers manifest with encoded expression`, async () => {
    const cronSource = cron(`*/30 * * * *`)
    const { ctx } = makeCtx()
    const handle = await ctx.observe(cronSource)
    const timezone = `UTC`

    expect(handle.sourceType).toBe(`cron`)
    expect(handle.sourceRef).toBe(getCronSourceRef(`*/30 * * * *`, timezone))
    expect(handle.db).toBeUndefined()

    const manifest = ctx.getManifest()
    const entry = manifest.find(
      (m) => m.kind === `source` && m.sourceType === `cron`
    )
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({
      kind: `source`,
      sourceType: `cron`,
      sourceRef: getCronSourceRef(`*/30 * * * *`, timezone),
      config: {
        expression: `*/30 * * * *`,
        timezone,
      },
    })
  })

  it(`custom source with streamUrl registers wireDb on source handle`, async () => {
    const webhookSource: ObservationSource = {
      sourceType: `webhook`,
      sourceRef: `/incoming/stripe`,
      streamUrl: `/webhooks/stripe/events`,
      schema: {
        events: {
          type: `webhook_event`,
          primaryKey: `key`,
        },
      },
      wake() {
        return {
          sourceUrl: `/webhooks/stripe/events`,
          condition: { on: `change` as const, collections: [`events`] },
        }
      },
      toManifestEntry() {
        return {
          key: `source:webhook:/incoming/stripe`,
          kind: `source` as const,
          sourceType: `webhook`,
          sourceRef: `/incoming/stripe`,
          config: { path: `/incoming/stripe` },
        }
      },
    }

    const { ctx } = makeCtx()
    const handle = await ctx.observe(webhookSource)

    expect(handle.sourceType).toBe(`webhook`)
    expect(handle.sourceRef).toBe(`/incoming/stripe`)
    // In test path (no wiring), db is undefined even with streamUrl
    expect(handle.db).toBeUndefined()

    const manifest = ctx.getManifest()
    const entry = manifest.find(
      (m) => m.kind === `source` && m.sourceType === `webhook`
    )
    expect(entry).toBeDefined()
    expect(entry).toMatchObject({
      kind: `source`,
      sourceType: `webhook`,
      sourceRef: `/incoming/stripe`,
      config: { path: `/incoming/stripe` },
    })

    // Source handle should have wireDb defined since streamUrl was set
    const sourceHandles = ctx.getSourceHandles()
    const handleInfo = sourceHandles.get(`/incoming/stripe`)
    expect(handleInfo).toBeDefined()
    expect(handleInfo!.sourceType).toBe(`webhook`)
    expect(typeof handleInfo!.wireDb).toBe(`function`)
  })
})
