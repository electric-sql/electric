import {
  createCollection,
  eq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@durable-streams/state/db'
import { createWakeSession } from './wake-session'
import { appendPathToUrl } from './url'
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
  SendResult,
  SelfHandle,
  SharedStateHandle,
  SharedStateHandleInfo,
  SharedStateSchemaMap,
  SourceHandleInfo,
  SpawnHandleInfo,
  SpawnSandboxOption,
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
      initialMessageType?: string
      wake?: Wake
      tags?: Record<string, string>
      sandbox?: SpawnSandboxOption
    }
  ) => Promise<{ entityUrl: string; streamPath: string }>
  /**
   * Fork a top-level entity at the server-resolved latest completed
   * run. Returns the new root entity's URL + main stream path.
   *
   * Optional `parent` makes the new fork a child of that URL; pair with
   * `wake` to register a subscription at fork time. The `condition`
   * here is the agents-server's normalized wake shape (`'runFinished'`
   * or `{ on: 'change', ... }`) — callers above this layer (`doFork`)
   * translate the user-facing `Wake` into this form, the same way
   * createOrGetChild does for spawn.
   */
  forkEntity: (
    sourceEntityUrl: string,
    opts?: {
      /**
       * Caller-supplied instance id for the new fork (wired to the
       * server's `instance_id` body field). Omit to let the server
       * mint one (currently `<source-id>-fork-<hash>`).
       */
      instanceId?: string
      /**
       * Parent URL for the new fork. When set, the fork becomes a
       * child of this URL and the wake registration's subscriberUrl
       * is derived from it (matching the spawn route's contract).
       */
      parent?: string
      /**
       * User-facing Wake; the wiring impl normalizes it into the
       * wakeRegistry-compatible shape before sending to the server
       * — same translation `createOrGetChild` does for spawn.
       */
      wake?: Wake
      initialMessage?: unknown
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
  /** Ensure a generic observation stream exists before creating a StreamDB. */
  ensureSourceStream?: (streamUrl: string, contentType: string) => Promise<void>
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
  executeSend?: (send: PendingSend) => Promise<SendResult>
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
      initialMessageType?: string
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  /**
   * Fork a source entity at its latest completed run. Returns an
   * EntityHandle for the new fork — same shape spawn returns. The
   * fork is created as a CHILD of this setup-context's entity
   * (parent = entityUrl) unless `observe: false`. Mirrors spawn's
   * flow: builds the handle, registers a spawn handle on wakeSession,
   * then calls `wiring.forkEntity` to do the server-side fork.
   */
  fork: (
    sourceEntityUrl: string,
    id: string,
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
  ) => Promise<SendResult>
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

  const dispatchSend = (send: PendingSend): Promise<SendResult> => {
    if (executeSendFn) {
      return executeSendFn(send)
    }
    wakeSession.enqueueSend(send)
    return Promise.resolve({ queued: true as const, targetUrl: send.targetUrl })
  }

  const sendToEntity = (
    targetUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ): Promise<SendResult> => {
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
    return dispatchSend({
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
          },
          { preload: shouldPreload }
        )

        if (!shouldPreload) {
          deferredObservedHandles.set(targetUrl, observedDb)
        }

        const handle: EntityHandle = {
          entityUrl: targetUrl,
          db: observedDb,
          events: observeEvents,
          sourceType: `entity`,
          sourceRef: targetUrl,
          send: (msg: unknown) => {
            if (inSetup) {
              throw new Error(
                `[agent-runtime] send() cannot be called during setup() on observed entity handles`
              )
            }
            return dispatchSend({ targetUrl, payload: msg })
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
      const handle: EntityHandle = {
        entityUrl: targetUrl,
        sourceType: `entity`,
        sourceRef: targetUrl,
        db: null as unknown as EntityStreamDB,
        events: [],
        send: (msg: unknown) => {
          if (inSetup) {
            throw new Error(
              `[agent-runtime] send() cannot be called during setup() on observed entity handles`
            )
          }
          return dispatchSend({ targetUrl, payload: msg })
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
      if (source.ensureStream && wiring.ensureSourceStream) {
        await wiring.ensureSourceStream(
          source.streamUrl,
          source.ensureStream.contentType
        )
      }
      const sourceStreamUrl = source.streamUrl.startsWith(`/`)
        ? appendPathToUrl(config.serverBaseUrl, source.streamUrl)
        : source.streamUrl
      sourceDb = await wiring.createSourceDb(
        sourceStreamUrl,
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
      streamUrl: source.streamUrl,
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
        initialMessageType?: string
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
        sandbox?: SpawnSandboxOption
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

      let spawnError: Error | null = null

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
        send: (msg: unknown) => {
          if (inSetup) {
            throw new Error(
              `child.send() cannot be called during setup() — use them in effects instead`
            )
          }
          if (spawnError) {
            throw spawnError
          }
          const result = dispatchSend({
            targetUrl: realEntityUrl,
            payload: msg,
          })
          return result
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
                initialMessageType: opts?.initialMessageType,
                wake: opts?.wake,
                tags: opts?.tags,
                sandbox: opts?.sandbox,
              }
            )
          realEntityUrl = childUrl
          wakeSession.registerManifestEntry(childRow(childUrl))

          if (observeChild) {
            const childDb = await wiring.createChildDb(
              `${config.serverBaseUrl}${streamPath}`,
              type,
              () => {}
            )
            handle.db = childDb
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
      const dbReady = new Promise<void>((resolveDb, _rejectDb) => {
        wakeSession.registerSpawnHandle(id, {
          wireDb: (childDb: EntityStreamDBWithActions) => {
            handle.db = childDb
            resolveDb()
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

    async fork(
      sourceEntityUrl: string,
      id: string,
      opts?: {
        initialMessage?: unknown
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
      }
    ): Promise<EntityHandle> {
      const observeChild = opts?.observe !== false
      // The fork's type is the source's type — fork is a copy, not a
      // new entity type. Parse it from the source URL.
      const parsedSourceUrl = sourceEntityUrl
        .split(`/`)
        .filter((segment) => segment.length > 0)
      const type = parsedSourceUrl[0] ?? `unknown`
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

      let forkError: Error | null = null

      // The server constructs the fork URL as `/<sourceType>/<id>` when
      // `instance_id` is supplied (current code path), so we know it up
      // front. Same property spawn relies on for its handle URL.
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
        send: (msg: unknown) => {
          if (inSetup) {
            throw new Error(
              `fork.send() cannot be called during setup() — use it in effects instead`
            )
          }
          if (forkError) {
            throw forkError
          }
          return dispatchSend({
            targetUrl: realEntityUrl,
            payload: msg,
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
        // Mirror spawn's order: register the spawn handle first, then
        // create the server-side fork.
        wakeSession.registerSpawnHandle(id, {
          wireDb: () => {},
          updateEntityUrl: (newUrl: string) => {
            realEntityUrl = newUrl
            if (observeChild) {
              wakeSession.registerManifestEntry(childRow(newUrl))
            }
          },
        })

        try {
          // For an observed (default) fork, register a wake on the
          // new fork firing back to this entity. Default to
          // `runFinished + includeResponse` when the caller didn't
          // pass a wake — matches spawn's default child-observation
          // shape. The wiring impl translates user-facing `Wake` into
          // the wakeRegistry's `{ subscriberUrl, condition, ... }`.
          const wakeForFork: Wake | undefined = observeChild
            ? (opts?.wake ?? {
                on: `runFinished`,
                includeResponse: true,
              })
            : undefined
          const { entityUrl: forkUrl, streamPath } = await wiring.forkEntity(
            sourceEntityUrl,
            {
              instanceId: id,
              ...(observeChild && { parent: entityUrl }),
              ...(wakeForFork && { wake: wakeForFork }),
              ...(opts?.initialMessage !== undefined && {
                initialMessage: opts.initialMessage,
              }),
              ...(opts?.tags && { tags: opts.tags }),
            }
          )
          realEntityUrl = forkUrl
          if (observeChild) {
            wakeSession.registerManifestEntry(childRow(forkUrl))

            const childDb = await wiring.createChildDb(
              `${config.serverBaseUrl}${streamPath}`,
              type,
              () => {}
            )
            handle.db = childDb
          }
        } catch (err) {
          forkError = err instanceof Error ? err : new Error(String(err))
          throw forkError
        }

        observeHandleCache.set(realEntityUrl, handle)

        return handle
      }

      // ---- Deferred wiring (unit test path) ---- same shape as spawn.
      const dbReady = new Promise<void>((resolveDb, _rejectDb) => {
        wakeSession.registerSpawnHandle(id, {
          wireDb: (childDb: EntityStreamDBWithActions) => {
            handle.db = childDb
            resolveDb()
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

    send(
      targetUrl: string,
      payload: unknown,
      opts?: { type?: string; afterMs?: number }
    ): Promise<SendResult> {
      return sendToEntity(targetUrl, payload, opts)
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
