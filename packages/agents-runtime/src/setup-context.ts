import {
  createCollection,
  eq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@durable-streams/state'
import { createWakeSession } from './wake-session'
import {
  manifestChildKey,
  manifestEffectKey,
  manifestSharedStateKey,
} from './manifest-helpers'
import type {
  DbObservationSource,
  EntityObservationSource,
} from './observation-sources'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  ChildStatus,
  EffectConfig,
  EntityDefinition,
  EntityHandle,
  EntityStreamDB,
  EntityStreamDBWithActions,
  JsonValue,
  ManifestChildEntry,
  ManifestEntry,
  ManifestSourceEntry,
  ObservationHandle,
  ObservationSource,
  ObservationStreamDB,
  PendingSend,
  SelfHandle,
  SharedStateHandle,
  SharedStateHandleInfo,
  SharedStateSchemaMap,
  SourceHandleInfo,
  SpawnHandleInfo,
  StateCollectionProxy,
  StateProxy,
  Wake,
  WakeSession,
} from './types'

interface EffectScope {
  register: (
    key: string,
    config: EffectConfig,
    opts?: { activatedFromReplay?: boolean }
  ) => void
}

export interface WiringConfig {
  /** Create or get an existing child entity via the server API. Returns the server-assigned URL and stream path. */
  createOrGetChild: (
    type: string,
    id: string,
    spawnArgs: Record<string, unknown>,
    parentUrl: string,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
    }
  ) => Promise<{ entityUrl: string; streamPath: string }>
  /** Create a child StreamDB, preload it, and register it for cleanup. */
  createChildDb: (
    streamUrl: string,
    childTypeName?: string,
    onEvent?: (event: ChangeEvent) => void,
    opts?: { preload?: boolean }
  ) => Promise<EntityStreamDBWithActions>
  /** Create a generic observation StreamDB for non-entity sources. */
  createSourceDb: (
    streamUrl: string,
    schema: NonNullable<ObservationSource[`schema`]>,
    onEvent?: (event: ChangeEvent) => void,
    opts?: { preload?: boolean }
  ) => Promise<ObservationStreamDB>
  /** Create a shared state StreamDB (optionally creating the stream on the server first). */
  createSharedStateDb: (
    ssId: string,
    mode: `create` | `connect`,
    schema: SharedStateSchemaMap
  ) => Promise<EntityStreamDBWithActions>
}

export interface SetupContextConfig {
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  events: Array<ChangeEvent>
  writeEvent: (event: ChangeEvent) => void
  serverBaseUrl: string
  effectScope: EffectScope
  /** Names of custom state collections declared in the entity definition */
  customStateNames: Array<string>
  wakeSession?: WakeSession
  /** Entity definition — needed for createEffect factory calls during active phase */
  definition?: EntityDefinition
  /** Wiring helpers for inline spawn/observe — absent in unit tests */
  wiring?: WiringConfig
  /** Direct send executor — when provided, ctx.send() calls this immediately instead of queuing */
  executeSend?: (send: PendingSend) => void
}

export interface SetupContextResult {
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  self: SelfHandle
  state: StateProxy
  actions: Record<string, (...args: Array<unknown>) => unknown>
  spawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  send: (
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ) => void
  observe: (
    source: ObservationSource,
    opts?: { wake?: Wake }
  ) => Promise<ObservationHandle>
  createEffect: (
    functionRef: string,
    key: string,
    effectConfig: JsonValue
  ) => boolean
  mkdb: <TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema
  ) => SharedStateHandle<TSchema>
  getManifest: () => Array<ManifestEntry>
  getPendingSends: () => Array<PendingSend>
  getSharedStateHandles: () => Map<string, SharedStateHandleInfo>
  getSpawnHandles: () => Map<string, SpawnHandleInfo>
  getSourceHandles: () => Map<string, SourceHandleInfo>
  /** Returns the cached EntityHandles for observed entities (keyed by entity URL). */
  getSourceHandleCache: () => Map<string, EntityHandle>
  /** Flips the inSetup flag — called by the wake handler after setup() returns. */
  setInSetup: (value: boolean) => void
  /** Internal: wire an observe handle without forcing preload immediately. */
  ensureObservedHandle: (
    source: ObservationSource,
    opts?: { preload?: boolean; wake?: Wake }
  ) => Promise<ObservationHandle>
  /** Internal: preload any observed handles that were wired lazily during replay. */
  preloadDeferredObservedHandles: () => Promise<void>
  /** Internal: rebuild persisted shared-state handles so later wakes see live data immediately. */
  restorePersistedSharedStateHandles: () => void
}

export function createSetupContext(
  config: SetupContextConfig
): SetupContextResult {
  const {
    entityUrl,
    entityType,
    args,
    db,
    effectScope,
    customStateNames = [],
    wakeSession = createWakeSession(db),
    definition,
    wiring,
    executeSend: executeSendFn,
  } = config
  let inSetup = true

  const dbActions =
    (
      db as EntityStreamDBWithActions & {
        actions?: Record<string, (...args: Array<unknown>) => unknown>
      }
    ).actions ?? {}

  // Build ctx.state proxy — routes CRUD through auto-generated actions,
  // reads through the underlying TanStack DB collection.
  const stateProxy: StateProxy = {}
  for (const name of customStateNames) {
    const insertAction = dbActions[`${name}_insert`]
    const updateAction = dbActions[`${name}_update`]
    const deleteAction = dbActions[`${name}_delete`]
    const collection = db.collections[name]

    const proxy: StateCollectionProxy = {
      insert: (row: Record<string, unknown>) => {
        if (!insertAction) {
          throw new Error(
            `[agent-runtime] No insert action for collection "${name}"`
          )
        }
        return insertAction({ row })
      },
      update: (
        key: string,
        updater: (draft: Record<string, unknown>) => void
      ) => {
        if (!updateAction) {
          throw new Error(
            `[agent-runtime] No update action for collection "${name}"`
          )
        }
        return updateAction({ key, updater })
      },
      delete: (key: string) => {
        if (!deleteAction) {
          throw new Error(
            `[agent-runtime] No delete action for collection "${name}"`
          )
        }
        return deleteAction({ key })
      },
      get: (key: string) => {
        return collection?.get(key) as Record<string, unknown> | undefined
      },
      get toArray() {
        return (collection?.toArray ?? []) as Array<Record<string, unknown>>
      },
    }

    stateProxy[name] = proxy
  }

  // Build ctx.actions — exposes custom actions (already wrapped in createOptimisticAction)
  const customActions: Record<string, (...args: Array<unknown>) => unknown> = {}
  for (const [actionName, actionFn] of Object.entries(dbActions)) {
    // Skip auto-generated CRUD actions — those are accessed via ctx.state
    const isCrud = customStateNames.some(
      (name) =>
        actionName === `${name}_insert` ||
        actionName === `${name}_update` ||
        actionName === `${name}_delete`
    )
    if (!isCrud) {
      customActions[actionName] = actionFn as (
        ...args: Array<unknown>
      ) => unknown
    }
  }

  const dispatchSend = (send: PendingSend): void => {
    if (executeSendFn) {
      executeSendFn(send)
    } else {
      wakeSession.enqueueSend(send)
    }
  }

  const sendToEntity = (
    targetUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ): void => {
    if (inSetup) {
      const manifestRows = db.collections.manifests
        .toArray as Array<ManifestEntry>
      const isChild =
        wakeSession
          .getManifest()
          .some(
            (entry) => entry.kind === `child` && entry.entity_url === targetUrl
          ) ||
        manifestRows.some(
          (entry) => entry.kind === `child` && entry.entity_url === targetUrl
        )
      if (!isChild) {
        throw new Error(
          `[agent-runtime] send() cannot be called during setup() except to child entities`
        )
      }
    }
    dispatchSend({
      targetUrl,
      payload,
      type: opts?.type,
      afterMs: opts?.afterMs,
    })
  }

  let ctx_ref: SetupContextResult

  // Cache for observe handles — enables idempotent observe() calls
  const observeHandleCache = new Map<string, EntityHandle>()
  const dbObserveCache = new Map<
    string,
    ObservationHandle & SharedStateHandle
  >()
  const deferredObservedHandles = new Map<string, EntityStreamDBWithActions>()

  const getEntityTypeFromUrl = (url: string): string | undefined => {
    const segments = url.split(`/`).filter(Boolean)
    return segments[0]
  }

  /**
   * Build a SharedStateHandle with a deferred StreamDB backing.
   *
   * The backing DB may be wired after the handle is created. Until then,
   * collection proxies write into local-only DB collections via real
   * TanStack transactions so handler code can continue using the handle
   * within the same run.
   */
  function buildSharedStateHandle<TSchema extends SharedStateSchemaMap>(
    id: string,
    schema: TSchema,
    mode: `create` | `connect`
  ): SharedStateHandle<TSchema> {
    const existingHandle = wakeSession.getSharedStateHandles().get(id)
    if (existingHandle) {
      if (mode === `create`) {
        throw new Error(
          `[agent-runtime] shared DB "${id}" already exists — use observe(db("${id}", schema)) to get a handle`
        )
      }
      return existingHandle.handle as SharedStateHandle<TSchema>
    }

    wakeSession.registerManifestEntry({
      kind: `shared-state`,
      key: manifestSharedStateKey(id),
      id,
      mode,
      collections: Object.fromEntries(
        Object.entries(schema).map(([collectionName, collectionSchema]) => [
          collectionName,
          {
            type: collectionSchema.type,
            primaryKey: collectionSchema.primaryKey,
          },
        ])
      ),
    })

    const handle = { id } as SharedStateHandle<TSchema>

    // Mutable ref swapped by wireDb — null means not yet connected
    let backingDb: EntityStreamDBWithActions | null = null

    const cloneRow = (
      row: Record<string, unknown>
    ): Record<string, unknown> => ({ ...row })

    const getPrimaryKey = (collName: string): string => {
      return schema[collName]!.primaryKey
    }

    const getRowKey = (
      collName: string,
      row: Record<string, unknown>
    ): string => {
      const key = row[getPrimaryKey(collName)]
      if (typeof key !== `string`) {
        throw new Error(
          `[agent-runtime] Shared state "${id}" collection "${collName}" requires string primary keys`
        )
      }
      return key
    }

    const stripVirtualFields = (
      row: Record<string, unknown> | undefined
    ): Record<string, unknown> | undefined => {
      if (!row) {
        return undefined
      }

      const clone = { ...row }
      delete clone.$collectionId
      delete clone.$key
      delete clone.$origin
      delete clone.$synced
      return clone
    }

    const createStagedCollection = (collName: string) => {
      return createCollection(
        localOnlyCollectionOptions<Record<string, unknown>>({
          id: `shared-state-staged:${id}:${collName}`,
          getKey: (row) => getRowKey(collName, row),
          initialData: [],
        })
      )
    }
    type StagedCollection = ReturnType<typeof createStagedCollection>
    type PendingSharedStateMutation =
      | {
          collectionName: string
          type: `insert`
          row: Record<string, unknown>
        }
      | {
          collectionName: string
          type: `update`
          key: string
          updater: (draft: Record<string, unknown>) => void
        }
      | {
          collectionName: string
          type: `delete`
          key: string
        }

    const localCollections = new Map<string, StagedCollection>(
      Object.keys(schema).map((collName) => {
        return [collName, createStagedCollection(collName)]
      })
    )
    const pendingMutations: Array<PendingSharedStateMutation> = []

    const getLocalCollection = (collName: string): StagedCollection => {
      const collection = localCollections.get(collName)
      if (!collection) {
        throw new Error(
          `[agent-runtime] Missing staged shared-state collection "${collName}" for "${id}"`
        )
      }
      return collection
    }

    const createResolvedMutationResult = () => {
      return {
        isPersisted: { promise: Promise.resolve() },
        state: `completed`,
        mutations: [],
      }
    }

    const assertConnectedSharedState = (collName: string): void => {
      if (backingDb || mode === `create`) {
        return
      }
      throw new Error(
        `[agent-runtime] shared DB "${id}" is not loaded yet — wait for observe(db("${id}", schema)) to finish wiring before reading or writing "${collName}"`
      )
    }

    for (const [collName] of Object.entries(schema)) {
      const proxy: StateCollectionProxy = {
        insert: (row: Record<string, unknown>) => {
          if (!backingDb) {
            assertConnectedSharedState(collName)
            const nextRow = cloneRow(row)
            getLocalCollection(collName).insert(nextRow)
            pendingMutations.push({
              collectionName: collName,
              type: `insert`,
              row: nextRow,
            })
            return createResolvedMutationResult()
          }
          const sharedDb = backingDb
          const insertAction = sharedDb.actions[`${collName}_insert`]
          return insertAction?.({ row })
        },
        update: (
          key: string,
          updater: (draft: Record<string, unknown>) => void
        ) => {
          if (!backingDb) {
            assertConnectedSharedState(collName)
            const primaryKey = getPrimaryKey(collName)
            const collection = getLocalCollection(collName)
            if (!collection.has(key)) {
              collection.insert({ [primaryKey]: key })
            }
            collection.update(key, (draft) => {
              updater(draft)
              draft[primaryKey] = key
            })
            pendingMutations.push({
              collectionName: collName,
              type: `update`,
              key,
              updater,
            })
            return createResolvedMutationResult()
          }
          const sharedDb = backingDb
          const updateAction = sharedDb.actions[`${collName}_update`]
          return updateAction?.({
            key,
            updater: updater as (draft: object) => void,
          })
        },
        delete: (key: string) => {
          if (!backingDb) {
            assertConnectedSharedState(collName)
            getLocalCollection(collName).delete(key)
            pendingMutations.push({
              collectionName: collName,
              type: `delete`,
              key,
            })
            return createResolvedMutationResult()
          }
          const sharedDb = backingDb
          const deleteAction = sharedDb.actions[`${collName}_delete`]
          return deleteAction?.({ key })
        },
        get: (key: string) => {
          if (!backingDb) {
            assertConnectedSharedState(collName)
            return stripVirtualFields(
              getLocalCollection(collName).get(key) as
                | Record<string, unknown>
                | undefined
            )
          }
          return backingDb.collections[collName]?.get(key) as
            | Record<string, unknown>
            | undefined
        },
        get toArray() {
          if (!backingDb) {
            assertConnectedSharedState(collName)
            return getLocalCollection(collName)
              .toArray.map((row) =>
                stripVirtualFields(row as Record<string, unknown>)
              )
              .filter(Boolean) as Array<Record<string, unknown>>
          }
          return (backingDb.collections[collName]?.toArray ?? []) as Array<
            Record<string, unknown>
          >
        },
      }

      Object.defineProperty(proxy, `__electricCollection`, {
        enumerable: false,
        configurable: false,
        get: () => backingDb?.collections[collName],
      })
      ;(handle as Record<string, unknown>)[collName] = proxy
    }

    // Register wireDb so processWake can connect the real StreamDB
    wakeSession.registerSharedStateHandle(id, {
      mode,
      schema,
      handle: handle as SharedStateHandle,
      wireDb: async (sharedDb: EntityStreamDBWithActions) => {
        for (const mutation of pendingMutations) {
          if (mutation.type === `insert`) {
            const insertAction =
              sharedDb.actions[`${mutation.collectionName}_insert`]
            insertAction?.({ row: mutation.row })
            continue
          }

          if (mutation.type === `update`) {
            const updateAction =
              sharedDb.actions[`${mutation.collectionName}_update`]
            updateAction?.({
              key: mutation.key,
              updater: mutation.updater as (draft: object) => void,
            })
            continue
          }

          const deleteAction =
            sharedDb.actions[`${mutation.collectionName}_delete`]
          deleteAction?.({ key: mutation.key })
        }

        pendingMutations.length = 0
        backingDb = sharedDb
      },
    })

    return handle
  }

  function restorePersistedSharedStateHandles(): void {
    const manifestRows = db.collections.manifests?.toArray as
      | Array<ManifestEntry>
      | undefined
    if (!manifestRows) return

    const persistedSharedStates = new Map<
      string,
      {
        mode: `create` | `connect`
        schema: SharedStateSchemaMap
      }
    >()

    for (const entry of manifestRows) {
      if (entry.kind !== `shared-state`) continue

      const schemaEntries: Array<[string, SharedStateSchemaMap[string]]> = []
      for (const [collectionName, collectionConfig] of Object.entries(
        entry.collections
      )) {
        schemaEntries.push([
          collectionName,
          {
            schema: undefined,
            type: collectionConfig.type,
            primaryKey: collectionConfig.primaryKey,
          },
        ])
      }

      if (schemaEntries.length === 0) continue

      persistedSharedStates.set(entry.id, {
        mode: entry.mode,
        schema: Object.fromEntries(schemaEntries) as SharedStateSchemaMap,
      })
    }

    // Later wakes need the same shared-state handles rebuilt from the
    // persisted manifest even if the current handler never reconnects them
    // explicitly. process-wake will wire the backing DBs immediately after.
    for (const [sharedStateId, persisted] of persistedSharedStates) {
      buildSharedStateHandle(sharedStateId, persisted.schema, persisted.mode)
    }
  }

  type OffsetAwareCollection<TRow extends { key: string | number }> = {
    toArray: Array<TRow>
    __electricRowOffsets?: Map<string | number, string>
  }

  function sortRowsByCollectionOrder<TRow extends { key: string | number }>(
    collection: OffsetAwareCollection<TRow>
  ): Array<TRow> {
    return [...collection.toArray].sort((left, right) => {
      const leftOffset = collection.__electricRowOffsets?.get(left.key)
      const rightOffset = collection.__electricRowOffsets?.get(right.key)
      if (leftOffset && rightOffset) {
        return leftOffset.localeCompare(rightOffset)
      }
      if (leftOffset) return -1
      if (rightOffset) return 1

      const leftSeq = Reflect.get(left, `_seq`)
      const rightSeq = Reflect.get(right, `_seq`)
      if (typeof leftSeq === `number` && typeof rightSeq === `number`) {
        return leftSeq - rightSeq
      }
      if (typeof leftSeq === `number`) return -1
      if (typeof rightSeq === `number`) return 1
      return String(left.key).localeCompare(String(right.key))
    })
  }

  function readCompletedRunTexts(childDb: EntityStreamDB): Array<string> {
    const runs = sortRowsByCollectionOrder(childDb.collections.runs)
    const deltas = sortRowsByCollectionOrder(childDb.collections.textDeltas)

    const completedRunIds = runs
      .filter((r) => r.status === `completed`)
      .map((r) => r.key)

    const deltasByRun = new Map<string, Array<string>>()
    for (const d of deltas) {
      const chunks = deltasByRun.get(d.run_id) ?? []
      chunks.push(d.delta)
      deltasByRun.set(d.run_id, chunks)
    }

    return completedRunIds
      .map((runId) => (deltasByRun.get(runId) ?? []).join(``))
      .filter((text) => text.length > 0)
  }

  function latestRunStatus(
    childDb: EntityStreamDB
  ): `completed` | `failed` | `running` | null {
    const runs = childDb.collections.runs.toArray as Array<{
      key: string
      status: string
    }>
    const latestRun = runs.at(-1)
    if (!latestRun) return null
    if (latestRun.status === `completed` || latestRun.status === `failed`) {
      return latestRun.status
    }
    return `running`
  }

  async function ensureObservedHandle(
    source: ObservationSource,
    opts?: { preload?: boolean; wake?: Wake }
  ): Promise<ObservationHandle> {
    // Entity sources use the entity-specific path with EntityHandle
    if (source.sourceType === `entity`) {
      const targetUrl = (source as EntityObservationSource).entityUrl
      const cached = observeHandleCache.get(targetUrl)
      if (cached) {
        wakeSession.registerManifestEntry({
          ...source.toManifestEntry(),
          ...(opts?.wake ? { wake: opts.wake } : {}),
        })
        return cached
      }

      const shouldPreload = opts?.preload !== false
      const manifestEntry = source.toManifestEntry()
      const persistedManifestEntry = [
        ...wakeSession.getManifest(),
        ...(db.collections.manifests.toArray as Array<ManifestEntry>),
      ].find(
        (entry): entry is ManifestSourceEntry =>
          entry.kind === `source` &&
          entry.sourceType === `entity` &&
          entry.sourceRef === targetUrl
      )
      const persistedConfig = persistedManifestEntry?.config
      const streamPath =
        typeof persistedConfig?.streamPath === `string`
          ? persistedConfig.streamPath
          : `${targetUrl}/main`
      const observedType =
        typeof persistedConfig?.entityType === `string`
          ? persistedConfig.entityType
          : getEntityTypeFromUrl(targetUrl)

      // ---- Inline wiring (production path) ----
      if (wiring) {
        let runResolve: () => void = () => {}
        let runPromise: Promise<void> = Promise.resolve(undefined)
        const beginTrackedRun = () => {
          runPromise = new Promise<void>((resolve) => {
            runResolve = () => resolve(undefined)
          })
        }
        const resolveTrackedRun = () => {
          runResolve()
        }

        wakeSession.registerSourceHandle(targetUrl, {
          sourceType: `entity`,
          wireDb: () => {},
        })
        const observeEvents: Array<ChangeEvent> = []
        wakeSession.registerManifestEntry({
          ...manifestEntry,
          config: {
            ...manifestEntry.config,
            streamPath,
            ...(observedType ? { entityType: observedType } : {}),
          },
          ...(opts?.wake ? { wake: opts.wake } : {}),
        })
        const observedDb = await wiring.createChildDb(
          `${config.serverBaseUrl}${streamPath}`,
          observedType,
          (event) => {
            observeEvents.push(event)
            if (event.type === `run` && event.headers.operation === `update`) {
              const value = event.value as { status?: string } | undefined
              if (value?.status === `completed` || value?.status === `failed`) {
                resolveTrackedRun()
              }
            }
          },
          { preload: shouldPreload }
        )

        if (!shouldPreload) {
          deferredObservedHandles.set(targetUrl, observedDb)
        }

        if (latestRunStatus(observedDb) !== `running`) {
          resolveTrackedRun()
        }

        const handle: EntityHandle = {
          entityUrl: targetUrl,
          db: observedDb,
          events: observeEvents,
          sourceType: `entity`,
          sourceRef: targetUrl,
          get run() {
            return runPromise
          },
          async text() {
            await this.run
            return readCompletedRunTexts(this.db)
          },
          send: (msg: unknown) => {
            if (inSetup) {
              throw new Error(
                `[agent-runtime] send() cannot be called during setup() on observed entity handles`
              )
            }
            beginTrackedRun()
            dispatchSend({ targetUrl, payload: msg })
          },
          status: () => {
            const statusEntries = db.collections.childStatus?.toArray as
              | Array<ChildStatus>
              | undefined
            return statusEntries?.find((e) => e.entity_url === targetUrl)
          },
        }

        observeHandleCache.set(targetUrl, handle)
        return handle
      }

      // ---- Deferred wiring (unit test path) ----
      let runResolve: () => void = () => {}
      let runPromise: Promise<void> = Promise.resolve(undefined)
      const handle: EntityHandle = {
        entityUrl: targetUrl,
        sourceType: `entity`,
        sourceRef: targetUrl,
        db: null as unknown as EntityStreamDB,
        events: [],
        get run() {
          return runPromise
        },
        async text() {
          await this.run
          return readCompletedRunTexts(this.db)
        },
        send: (msg: unknown) => {
          if (inSetup) {
            throw new Error(
              `[agent-runtime] send() cannot be called during setup() on observed entity handles`
            )
          }
          dispatchSend({ targetUrl, payload: msg })
        },
        status: () => {
          const statusEntries = db.collections.childStatus?.toArray as
            | Array<ChildStatus>
            | undefined
          return statusEntries?.find((e) => e.entity_url === targetUrl)
        },
      }

      const dbReady = new Promise<void>((resolve) => {
        wakeSession.registerSourceHandle(targetUrl, {
          sourceType: `entity`,
          wireDb: (observedDb) => {
            if (!(`actions` in observedDb)) {
              throw new Error(
                `[agent-runtime] Expected entity observation for ${targetUrl} to wire an entity DB`
              )
            }
            handle.db = observedDb
            runPromise = new Promise<void>((res) => {
              runResolve = () => res(undefined)
            })
            if (latestRunStatus(observedDb) !== `running`) {
              runResolve()
            }
            resolve()
          },
        })
      })

      wakeSession.registerManifestEntry({
        ...manifestEntry,
        ...(opts?.wake ? { wake: opts.wake } : {}),
      })

      await dbReady

      observeHandleCache.set(targetUrl, handle)
      return handle
    }

    // ---- Shared DB source path ----
    if (source.sourceType === `db`) {
      const dbSource = source as DbObservationSource
      const manifestEntry = source.toManifestEntry()

      const cached = dbObserveCache.get(dbSource.dbId)
      if (cached) {
        wakeSession.registerManifestEntry({
          ...manifestEntry,
          ...(opts?.wake ? { wake: opts.wake } : {}),
        })
        return cached
      }

      wakeSession.registerManifestEntry({
        ...manifestEntry,
        ...(opts?.wake ? { wake: opts.wake } : {}),
      })

      const handle = buildSharedStateHandle(
        dbSource.dbId,
        dbSource.schema,
        `connect`
      )

      const observationHandle: ObservationHandle & SharedStateHandle =
        Object.assign(handle as SharedStateHandle, {
          sourceType: `db` as const,
          sourceRef: dbSource.dbId,
          events: [] as Array<ChangeEvent>,
        })

      dbObserveCache.set(dbSource.dbId, observationHandle)
      return observationHandle
    }

    // ---- Generic source path (cron, custom, etc.) ----
    const manifestEntry = source.toManifestEntry()
    wakeSession.registerManifestEntry({
      ...manifestEntry,
      ...(opts?.wake ? { wake: opts.wake } : {}),
    })

    const events: Array<ChangeEvent> = []
    let sourceDb: ObservationStreamDB | undefined

    if (source.streamUrl && source.schema && wiring) {
      sourceDb = await wiring.createSourceDb(
        source.streamUrl,
        source.schema,
        (event: ChangeEvent) => {
          events.push(event)
        },
        { preload: opts?.preload }
      )
    }

    wakeSession.registerSourceHandle(source.sourceRef, {
      sourceType: source.sourceType,
      wireDb: source.streamUrl
        ? (wiredDb) => {
            sourceDb = wiredDb
          }
        : undefined,
    })

    return {
      sourceType: source.sourceType,
      sourceRef: source.sourceRef,
      db: sourceDb,
      events,
    }
  }

  const result: SetupContextResult = {
    entityUrl,
    entityType,
    args,
    db,
    self: {
      entityUrl,
      send: (payload: unknown, opts?: { type?: string; afterMs?: number }) =>
        sendToEntity(entityUrl, payload, opts),
    },
    state: stateProxy,
    actions: customActions,

    async spawn(
      type: string,
      id: string,
      spawnArgs?: Record<string, unknown>,
      opts?: {
        initialMessage?: unknown
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
      }
    ): Promise<EntityHandle> {
      const observeChild = opts?.observe !== false
      const childKey = manifestChildKey(type, id)
      const childRow = (entityUrl: string): ManifestChildEntry => ({
        kind: `child`,
        key: childKey,
        id,
        entity_type: type,
        entity_url: entityUrl,
        observed: true,
        ...(opts?.wake ? { wake: opts.wake } : {}),
      })

      let runResolve: () => void
      let spawnError: Error | null = null
      let runPromise = new Promise<void>((resolve) => {
        runResolve = resolve
      })

      let realEntityUrl = `/${type}/${id}`

      const handle: EntityHandle = {
        sourceType: `entity`,
        get sourceRef() {
          return realEntityUrl
        },
        get entityUrl() {
          return realEntityUrl
        },
        type,
        db: null as unknown as EntityStreamDB,
        events: [],
        get run(): Promise<void> {
          if (inSetup) {
            throw new Error(
              `child.run cannot be called during setup() — use them in effects instead`
            )
          }
          if (!observeChild) {
            return Promise.reject(
              new Error(
                `child.run is unavailable — spawn(${type}, ${id}, ..., { observe: false }) opted out of child observation`
              )
            )
          }
          if (spawnError) {
            return Promise.reject(spawnError)
          }
          return runPromise
        },
        async text(): Promise<Array<string>> {
          if (!observeChild) {
            throw new Error(
              `child.text is unavailable — spawn(${type}, ${id}, ..., { observe: false }) opted out of child observation`
            )
          }
          await this.run
          return readCompletedRunTexts(this.db)
        },
        send: (msg: unknown) => {
          if (inSetup) {
            throw new Error(
              `child.send() cannot be called during setup() — use them in effects instead`
            )
          }
          if (spawnError) {
            throw spawnError
          }
          dispatchSend({ targetUrl: realEntityUrl, payload: msg })
          runPromise = new Promise<void>((resolve) => {
            runResolve = resolve
          })
        },
        status: () => {
          const entries = db.collections.childStatus?.toArray as
            | Array<ChildStatus>
            | undefined
          return entries?.find(
            (e) =>
              e.entity_url === realEntityUrl ||
              e.entity_url === `/${type}/${id}`
          )
        },
      }

      // ---- Inline wiring (production path) ----
      if (wiring) {
        // Register spawn handle FIRST, then manifest entry
        wakeSession.registerSpawnHandle(id, {
          wireDb: () => {},
          resolveRun: () => {
            runResolve!()
          },
          rejectRun: (reason: Error) => {
            spawnError = reason
          },
          updateEntityUrl: (newUrl: string) => {
            realEntityUrl = newUrl
            wakeSession.registerManifestEntry(childRow(newUrl))
          },
        })
        // Check dedup before creating child
        const existingChild = await queryOnce((q) =>
          q
            .from({ manifests: db.collections.manifests })
            .where(({ manifests }) => eq(manifests.key, childKey))
            .findOne()
        )
        if (existingChild?.kind === `child`) {
          throw new Error(
            `[agent-runtime] child "${type}:${id}" already exists — use observe(entity("${existingChild.entity_url}")) to get a handle`
          )
        }

        try {
          const { entityUrl: childUrl, streamPath } =
            await wiring.createOrGetChild(
              type,
              id,
              spawnArgs ?? {},
              entityUrl,
              {
                initialMessage: opts?.initialMessage,
                wake: opts?.wake,
                tags: opts?.tags,
              }
            )
          realEntityUrl = childUrl
          wakeSession.registerManifestEntry(childRow(childUrl))

          if (observeChild) {
            const childDb = await wiring.createChildDb(
              `${config.serverBaseUrl}${streamPath}`,
              type,
              (event) => {
                if (
                  event.type === `run` &&
                  event.headers.operation === `update`
                ) {
                  const val = event.value as { status?: string } | undefined
                  if (val?.status === `completed` || val?.status === `failed`) {
                    runResolve!()
                  }
                }
              }
            )
            handle.db = childDb

            // Check if child already has a completed run

            const runs = childDb.collections.runs?.toArray as
              | Array<{ key: string; status: string }>
              | undefined
            if (runs) {
              const latestRun = runs[runs.length - 1]
              if (
                latestRun &&
                (latestRun.status === `completed` ||
                  latestRun.status === `failed`)
              ) {
                runResolve!()
              }
            }
          }
        } catch (err) {
          spawnError = err instanceof Error ? err : new Error(String(err))
          throw spawnError
        }

        observeHandleCache.set(realEntityUrl, handle)

        return handle
      }

      // ---- Deferred wiring (unit test path) ----
      // Register spawn handle FIRST so dynamic callbacks can find it
      const dbReady = new Promise<void>((resolveDb, rejectDb) => {
        wakeSession.registerSpawnHandle(id, {
          wireDb: (childDb: EntityStreamDBWithActions) => {
            handle.db = childDb
            resolveDb()
          },
          resolveRun: () => {
            runResolve!()
          },
          rejectRun: (reason: Error) => {
            spawnError = reason
            rejectDb(reason)
          },
          updateEntityUrl: (newUrl: string) => {
            realEntityUrl = newUrl
            wakeSession.registerManifestEntry(childRow(newUrl))
          },
        })
      })

      wakeSession.registerManifestEntry(childRow(realEntityUrl))

      await dbReady

      return handle
    },

    send(targetUrl: string, payload: unknown, opts?: { type?: string }): void {
      sendToEntity(targetUrl, payload, opts)
    },

    async observe(
      source: ObservationSource,
      opts?: { wake?: Wake }
    ): Promise<ObservationHandle> {
      return ensureObservedHandle(source, { preload: true, ...opts })
    },

    createEffect(
      functionRef: string,
      key: string,
      effectConfig: JsonValue
    ): boolean {
      const manifestKey = manifestEffectKey(functionRef, key)
      const created = wakeSession.registerManifestEntry({
        kind: `effect`,
        key: manifestKey,
        id: key,
        function_ref: functionRef,
        config: effectConfig,
      })
      if (!created) return false

      if (!inSetup) {
        const effects = (definition as Record<string, unknown> | undefined)
          ?.effects as
          | Record<
              string,
              (
                ctx: unknown,
                config: JsonValue
              ) => EffectConfig | Promise<EffectConfig>
            >
          | undefined
        const effectFactory = effects?.[functionRef]
        if (!effectFactory) {
          throw new Error(
            `[agent-runtime] Unknown effect '${functionRef}'. Was it removed from the definition?`
          )
        }
        const factoryResult = effectFactory(ctx_ref, effectConfig)
        const registerEffect = (ec: EffectConfig) =>
          effectScope.register(manifestKey, ec)
        if (factoryResult instanceof Promise) {
          factoryResult.then(registerEffect)
        } else {
          registerEffect(factoryResult)
        }
      }

      return true
    },

    mkdb<TSchema extends SharedStateSchemaMap>(
      id: string,
      schema: TSchema
    ): SharedStateHandle<TSchema> {
      return buildSharedStateHandle(id, schema, `create`)
    },

    getManifest: () => wakeSession.getManifest(),
    getPendingSends: () => wakeSession.getPendingSends(),
    getSharedStateHandles: () => wakeSession.getSharedStateHandles(),
    getSpawnHandles: () => wakeSession.getSpawnHandles(),
    getSourceHandles: () => wakeSession.getSourceHandles(),
    getSourceHandleCache: () => new Map(observeHandleCache),
    setInSetup: (value: boolean) => {
      inSetup = value
    },
    ensureObservedHandle,
    preloadDeferredObservedHandles: async () => {
      const pending = Array.from(deferredObservedHandles.entries())
      deferredObservedHandles.clear()
      await Promise.all(
        pending.map(async ([, observedDb]) => {
          await observedDb.preload()
        })
      )
    },
    restorePersistedSharedStateHandles,
  }

  ctx_ref = result
  return result
}
