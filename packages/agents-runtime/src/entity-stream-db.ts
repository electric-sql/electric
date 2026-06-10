import {
  createStateSchema,
  isChangeEvent,
  isControlEvent,
} from '@durable-streams/state'
import {
  type CreateStreamDBOptions,
  createStreamDB,
  createTransaction,
  getStreamDBCollectionId,
} from '@durable-streams/state/db'
import { builtInCollections, passthrough } from './entity-schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { formatPointerOrderToken, type EventPointer } from './event-pointer'
import type {
  ChangeEvent,
  CollectionDefinition,
  StateEvent,
} from '@durable-streams/state'
import type {
  ActionDefinition,
  StreamDB,
  StreamDBWithActions,
} from '@durable-streams/state/db'
import type { JsonBatch } from '@durable-streams/client'
import type { EntityDefinition } from './types'

// Infer the definition type from the built-in collections so EntityStreamDB stays in sync
type BuiltInCollections = typeof builtInCollections
type EntityCollectionsDefinition = BuiltInCollections &
  Record<string, CollectionDefinition>
type EntityWriteTransaction = ReturnType<
  typeof createTransaction<Record<string, unknown>>
>
type StreamDBOptions = CreateStreamDBOptions<
  EntityCollectionsDefinition,
  Record<string, ActionDefinition>
>
type EntityStreamOptions = NonNullable<StreamDBOptions[`streamOptions`]>

interface EntityWriteUtils {
  createWriteTransaction: (opts?: {
    autoCommit?: boolean
    debugOrigin?: string
  }) => EntityWriteTransaction
  applyEvent: (event: ChangeEvent) => EntityWriteTransaction
  awaitWritesSettled: () => Promise<void>
  drainPendingWrites: () => Promise<void>
}

type EntityCollectionMeta = {
  __electricSourceDb?: EntityStreamDBWithActions
  __electricSourceId?: string
  __electricRowOffsets?: Map<string | number, EventPointer>
  __electricTimelineOrders?: Map<string | number, string>
}

type EntityCollections = {
  [K in keyof StreamDB<EntityCollectionsDefinition>[`collections`]]: StreamDB<EntityCollectionsDefinition>[`collections`][K] &
    EntityCollectionMeta
}

/**
 * Typed StreamDB over the entity stream schema. Provides typed TanStack DB
 * collections for all Electric Agents entity event types plus any custom state collections.
 */
export type EntityStreamDB = Omit<
  StreamDB<EntityCollectionsDefinition>,
  `collections` | `utils`
> & {
  collections: EntityCollections
  utils: StreamDB<EntityCollectionsDefinition>[`utils`] & EntityWriteUtils
}

/**
 * EntityStreamDB that also exposes generated + custom actions.
 */
export type EntityStreamDBWithActions = StreamDBWithActions<
  EntityCollectionsDefinition,
  Record<string, ActionDefinition>
> & {
  collections: EntityCollections
  utils: StreamDB<EntityCollectionsDefinition>[`utils`] & EntityWriteUtils
}

type EntityStreamDBOptions = {
  stream?: StreamDBOptions[`stream`]
  streamOptions?: Omit<EntityStreamOptions, `url` | `contentType`>
  onBeforeBatch?: (batch: JsonBatch<StateEvent>) => void
  onEvent?: (event: ChangeEvent) => void
  onBatch?: (batch: JsonBatch<StateEvent>) => void
  /** Actor identity stamped onto entity-authored state/shared writes. */
  actorFrom?: string
} & (
  | {
      /** Write a state event through the entity's shared producer (fire-and-forget). */
      writeEvent: (event: ChangeEvent) => void
      /** Flush buffered writes through the producer without closing it. */
      flushWrites: () => Promise<void>
    }
  | {
      writeEvent?: undefined
      flushWrites?: undefined
    }
)

const WRITE_TXID_TIMEOUT_MS = 20_000

// Wrap a Standard Schema so that named virtual columns (e.g. `_timeline_order`,
// `_principal`) survive the validation step. TanStack DB calls the schema's
// validate() on every insert/update and uses result.value as the stored row,
// so any key not explicitly passed through by the schema is dropped. We
// extract the virtual fields before validation and re-attach them after.
function wrapSchemaWithVirtualColumns<T extends object>(
  inner: StandardSchemaV1<T>,
  virtualColumns: Array<string>
): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1 as const,
      vendor: `electric-agents`,
      validate: (
        value: unknown
      ): StandardSchemaV1.Result<T> | Promise<StandardSchemaV1.Result<T>> => {
        if (typeof value !== `object` || value === null) {
          return inner[`~standard`].validate(value)
        }
        const record = value as Record<string, unknown>
        const saved: Record<string, unknown> = {}
        for (const col of virtualColumns) {
          if (col in record) saved[col] = record[col]
        }
        const result = inner[`~standard`].validate(value)
        if (result instanceof Promise) return result
        if (`issues` in result && result.issues) return result
        return { value: Object.assign({}, result.value, saved) as T }
      },
    },
  }
}

/**
 * Create a StreamDB connected to a Electric Agents entity stream.
 *
 * Merges built-in collections (runs, steps, texts, etc.) with custom entity
 * state collections, auto-generates CRUD actions for each custom collection,
 * and wraps the entity's custom actions factory.
 *
 * @param streamUrl - The full URL of the entity stream
 * @param customState - Optional map of custom collection definitions from the entity's `state:`
 * @param actionsFactory - Optional factory from the entity's `actions:` that receives raw collections
 * @returns A StreamDB with typed collections + generated actions.
 */
export function createEntityStreamDB(
  streamUrl: string,
  customState?: EntityDefinition[`state`],
  actionsFactory?: EntityDefinition[`actions`],
  opts?: EntityStreamDBOptions
): EntityStreamDBWithActions {
  const replayBatchOffset = { current: `-1` }
  // Convert entity-level CollectionDefinition (with optional JSON schema) to
  // stream-db CollectionDefinition (with Standard Schema validator + type + primaryKey)
  const streamCustomState: Record<string, CollectionDefinition> = {}
  const principalColumnByCollection = new Map<string, string>()
  if (customState) {
    for (const [name, def] of Object.entries(customState)) {
      const principalColumn = def.externallyWritable
        ? def.externallyWritable === true
          ? `_principal`
          : (def.externallyWritable.principalColumn ?? `_principal`)
        : undefined

      if (principalColumn) {
        principalColumnByCollection.set(name, principalColumn)
      }

      // When virtual columns are projected onto the row, wrap the user schema
      // to preserve those fields through TanStack DB's schema validation.
      const baseSchema = def.schema ?? passthrough()
      const virtualColumns = [
        `_timeline_order`,
        ...(principalColumn ? [principalColumn] : []),
      ]
      const schema = def.schema
        ? wrapSchemaWithVirtualColumns(baseSchema, virtualColumns)
        : baseSchema

      streamCustomState[name] = {
        schema,
        type: def.type ?? `state:${name}`,
        primaryKey: def.primaryKey ?? `key`,
      }
    }
  }

  const mergedCollections: EntityCollectionsDefinition = {
    ...builtInCollections,
    ...streamCustomState,
  }
  const collectionNameByEventType = new Map<string, string>()
  const rowOffsetsByCollection = new Map<
    string,
    Map<string | number, EventPointer>
  >()
  const timelineOrdersByCollection = new Map<
    string,
    Map<string | number, string>
  >()
  for (const [name, def] of Object.entries(mergedCollections)) {
    collectionNameByEventType.set(def.type, name)
    rowOffsetsByCollection.set(name, new Map())
    timelineOrdersByCollection.set(name, new Map())
  }

  // Tracks the END offset of the previous batch — i.e. the START
  // offset of the next batch's items, which is the anchor we pair
  // with each item's sub-offset to form an `EventPointer`. `null`
  // before any batch has arrived (anchor at stream start).
  let previousBatchOffset: string | null = null
  // Build a reverse map from TanStack DB collection id to schema key
  const collIdToSchemaKey: Record<string, string> = {}
  for (const name of Object.keys(mergedCollections)) {
    collIdToSchemaKey[getStreamDBCollectionId(streamUrl, name)] = name
  }

  // Create state schema with event helpers for creating validated ChangeEvents
  const stateSchema = createStateSchema(mergedCollections)

  // If no custom state and no actions factory, skip the actions factory entirely
  const hasCustomActions =
    opts?.writeEvent !== undefined ||
    Object.keys(streamCustomState).length > 0 ||
    actionsFactory != null

  type PendingStateMutation = {
    collection: { id: string }
    type: `insert` | `update` | `delete`
    modified: Record<string, unknown>
    original: Record<string, unknown>
    key: string
  }

  const principalColumns = new Set(principalColumnByCollection.values())
  const cleanRow = (row: Record<string, unknown>): Record<string, unknown> => {
    const clone = { ...row }
    delete clone._seq
    delete clone._timeline_order
    for (const col of principalColumns) {
      delete clone[col]
    }
    return clone
  }

  let persistQueue: Promise<void> = Promise.resolve()

  const persistMutationsNow = async (
    mutations: Array<PendingStateMutation>,
    awaitTxId?: (txid: string) => Promise<void>
  ): Promise<void> => {
    if (!opts?.writeEvent) {
      throw new Error(
        `[agent-runtime] Cannot write state events: no writeEvent provided to createEntityStreamDB`
      )
    }
    if (mutations.length === 0) {
      return
    }

    const actorFrom = opts.actorFrom
    const txid = crypto.randomUUID()

    for (const mutation of mutations) {
      const schemaKey = collIdToSchemaKey[mutation.collection.id]
      if (!schemaKey) {
        throw new Error(
          `[agent-runtime] Unknown collection id "${mutation.collection.id}" in transaction mutation`
        )
      }

      const helpers = stateSchema[schemaKey]
      if (!helpers) {
        throw new Error(
          `[agent-runtime] Missing state schema helper for "${schemaKey}"`
        )
      }
      const modified = cleanRow(mutation.modified)
      const original =
        Object.keys(mutation.original).length > 0
          ? cleanRow(mutation.original)
          : undefined
      const headers = { txid, ...(actorFrom ? { from: actorFrom } : {}) }

      if (mutation.type === `insert`) {
        opts.writeEvent(
          helpers.insert({
            value: modified,
            headers,
          })
        )
        continue
      }

      if (mutation.type === `update`) {
        opts.writeEvent(
          helpers.update({
            value: modified,
            ...(original ? { oldValue: original } : {}),
            headers,
          })
        )
        continue
      }

      opts.writeEvent(
        helpers.delete({
          key: mutation.key,
          ...(original ? { oldValue: original } : {}),
          headers,
        })
      )
    }

    await opts.flushWrites()
    if (awaitTxId) {
      await awaitTxId(txid)
    }
  }

  const persistMutations = async (
    mutations: Array<PendingStateMutation>,
    awaitTxId?: (txid: string) => Promise<void>
  ): Promise<void> => {
    const next = persistQueue.then(() =>
      persistMutationsNow(mutations, awaitTxId)
    )
    persistQueue = next.catch(() => undefined)
    await next
  }

  const db = createStreamDB({
    ...(opts?.stream
      ? { stream: opts.stream }
      : {
          streamOptions: {
            ...opts?.streamOptions,
            url: streamUrl,
            contentType: `application/json`,
          },
        }),
    ...(opts?.onEvent && { onEvent: opts.onEvent }),
    onBeforeBatch: (batch) => {
      opts?.onBeforeBatch?.(batch)
      replayBatchOffset.current = batch.offset
      // `Stream-Fork-Sub-Offset` addresses items WITHIN A SINGLE LOG
      // ENTRY (the first log entry past the anchor), not items globally
      // past the anchor. To mint server-compatible pointers we group
      // items in the batch by their `headers.offset` (= the end offset
      // of the log entry that produced them, stable at write time).
      // Each contiguous group of items sharing an `headers.offset` is
      // one log entry; within it sub-offsets are 1..K. The anchor
      // offset for that group is the END offset of the PRECEDING log
      // entry — either the previous distinct `headers.offset` we saw
      // in this batch, or `previousBatchOffset` for the first group in
      // a fresh batch.
      let currentEntryOffset: string | null = null
      let priorEntryOffset: string | null = previousBatchOffset
      let positionInEntry = 0
      batch.items.forEach((item) => {
        if (isControlEvent(item)) {
          if (item.headers.control === `reset`) {
            for (const offsets of rowOffsetsByCollection.values()) {
              offsets.clear()
            }
            for (const orders of timelineOrdersByCollection.values()) {
              orders.clear()
            }
            previousBatchOffset = null
            currentEntryOffset = null
            priorEntryOffset = null
            positionInEntry = 0
          }
          return
        }
        if (!isChangeEvent(item)) return
        const collectionName = collectionNameByEventType.get(item.type)
        if (!collectionName) return

        const itemEntryOffset =
          typeof (item.headers as Record<string, unknown>).offset === `string`
            ? ((item.headers as Record<string, unknown>).offset as string)
            : null
        if (itemEntryOffset !== currentEntryOffset) {
          // Boundary into a new log entry.
          priorEntryOffset = currentEntryOffset ?? previousBatchOffset
          currentEntryOffset = itemEntryOffset
          positionInEntry = 0
        }
        positionInEntry++

        const pointer: EventPointer = {
          offset: priorEntryOffset,
          subOffset: positionInEntry,
        }
        rowOffsetsByCollection.get(collectionName)?.set(item.key, pointer)

        if (item.headers.operation === `delete`) return
        if (typeof item.value !== `object` || item.value === null) return

        const orders = timelineOrdersByCollection.get(collectionName)
        if (!orders) return
        let order = orders.get(item.key)
        if (!order) {
          order = formatPointerOrderToken(pointer)
          orders.set(item.key, order)
        }
        ;(item.value as Record<string, unknown>)._timeline_order = order
        const principalColumn = principalColumnByCollection.get(collectionName)
        if (principalColumn) {
          const principal = (item.headers as Record<string, unknown>).principal
          if (principal !== undefined) {
            ;(item.value as Record<string, unknown>)[principalColumn] =
              principal
          }
        }
      })
      // After processing the batch, advance the anchor for next time.
      // `batch.offset` is the `Stream-Next-Offset` for this batch —
      // i.e. the cursor that the NEXT batch's items will be addressed
      // relative to.
      previousBatchOffset = batch.offset
    },
    onBatch: (batch) => {
      opts?.onBatch?.(batch)
    },
    state: mergedCollections,
    ...(hasCustomActions && {
      actions: ({ db: actionDb }) => {
        // Shared mutationFn: persists transaction mutations through the shared
        // producer and waits until the txid round-trips through StreamDB.
        const sharedMutationFn = async (
          _vars: unknown,
          {
            transaction,
          }: {
            transaction: { mutations: Array<PendingStateMutation> }
          }
        ): Promise<void> => {
          await persistMutations(transaction.mutations, (txid) =>
            actionDb.utils.awaitTxId(txid, WRITE_TXID_TIMEOUT_MS)
          )
        }

        const actions: Record<string, ActionDefinition> = {}

        // Auto-generated CRUD actions for each custom state collection
        for (const name of Object.keys(streamCustomState)) {
          const collection = actionDb.collections[name]!
          const primaryKey = streamCustomState[name]!.primaryKey
          actions[`${name}_insert`] = {
            onMutate: ({ row }: { row: Record<string, unknown> }) => {
              collection.insert(row as object)
            },
            mutationFn: sharedMutationFn,
          }
          actions[`${name}_update`] = {
            onMutate: ({
              key,
              updater,
            }: {
              key: string
              updater: (draft: Record<string, unknown>) => void
            }) => {
              if (collection.has(key)) {
                collection.update(key, updater as (draft: object) => void)
                return
              }

              const row: Record<string, unknown> = { [primaryKey]: key }
              updater(row)
              collection.insert(row as object)
            },
            mutationFn: sharedMutationFn,
          }
          actions[`${name}_delete`] = {
            onMutate: ({ key }: { key: string }) => {
              if (collection.has(key)) {
                collection.delete(key)
              }
            },
            mutationFn: sharedMutationFn,
          }
        }

        if (opts?.writeEvent) {
          const manifests = actionDb.collections.manifests!
          actions.manifests_insert = {
            onMutate: ({ row }: { row: Record<string, unknown> }) => {
              manifests.insert(row as object)
            },
            mutationFn: sharedMutationFn,
          }
          actions.manifests_update = {
            onMutate: ({
              key,
              updater,
            }: {
              key: string
              updater: (draft: Record<string, unknown>) => void
            }) => {
              if (manifests.has(key)) {
                manifests.update(key, updater as (draft: object) => void)
                return
              }

              const row: Record<string, unknown> = { key }
              updater(row)
              manifests.insert(row as object)
            },
            mutationFn: sharedMutationFn,
          }
          actions.manifests_delete = {
            onMutate: ({ key }: { key: string }) => {
              if (manifests.has(key)) {
                manifests.delete(key)
              }
            },
            mutationFn: sharedMutationFn,
          }
        }

        // Custom actions from entity definition
        if (actionsFactory) {
          const entityActions = actionsFactory(
            actionDb.collections as Record<string, unknown>
          )
          for (const [actionName, actionFn] of Object.entries(entityActions)) {
            actions[actionName] = {
              onMutate: (...args: Array<unknown>) => {
                ;(actionFn as (...a: Array<unknown>) => void)(...args)
              },
              mutationFn: sharedMutationFn,
            }
          }
        }

        return actions
      },
    }),
  }) as EntityStreamDB | EntityStreamDBWithActions

  // Built-in entities often have no custom state/actions. Normalize them to the
  // WithActions shape so setup/runtime code can always read db.actions safely.
  if (!(`actions` in db)) {
    ;(db as EntityStreamDBWithActions).actions = {}
  }

  const replayDb = db as EntityStreamDBWithActions & {
    __electricReplayBatchOffset?: { current: string }
    __electricReplaySourceId?: string
  }
  replayDb.__electricReplayBatchOffset = replayBatchOffset
  replayDb.__electricReplaySourceId = streamUrl
  const pendingWritePersistences = new Set<Promise<void>>()
  let nextWriteSequence = 0
  const pendingWriteSequences = new Set<number>()
  const writePersistenceErrors: Array<{ sequence: number; error: Error }> = []
  const writeSettledWaiters = new Set<{
    targetSequence: number
    resolve: () => void
  }>()

  const takeWritePersistenceErrorUpTo = (
    targetSequence: number
  ): Error | null => {
    const matching = writePersistenceErrors.filter(
      (entry) => entry.sequence <= targetSequence
    )
    if (matching.length === 0) {
      return null
    }

    for (const entry of matching) {
      const index = writePersistenceErrors.indexOf(entry)
      if (index >= 0) {
        writePersistenceErrors.splice(index, 1)
      }
    }

    if (matching.length === 1) {
      return matching[0]!.error
    }

    return new AggregateError(
      matching.map((entry) => entry.error),
      `[agent-runtime] Multiple write transaction persistence failures`
    )
  }

  const hasBlockingWrite = (targetSequence: number): boolean => {
    for (const sequence of pendingWriteSequences) {
      if (sequence <= targetSequence) {
        return true
      }
    }
    return false
  }

  const resolveWriteSettledWaiters = (): void => {
    for (const waiter of [...writeSettledWaiters]) {
      if (hasBlockingWrite(waiter.targetSequence)) {
        continue
      }
      writeSettledWaiters.delete(waiter)
      waiter.resolve()
    }
  }

  const trackPersistencePromise = (
    promise: Promise<unknown>,
    origin: string
  ): void => {
    const writeSequence = ++nextWriteSequence
    pendingWriteSequences.add(writeSequence)
    const persisted: Promise<void> = Promise.resolve(promise)
      .then(() => undefined)
      .catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err))
        writePersistenceErrors.push({ sequence: writeSequence, error })
        console.error(
          `[agent-runtime] Write transaction persistence failed (${origin}):`,
          error
        )
      })
      .finally(() => {
        pendingWritePersistences.delete(persisted)
        pendingWriteSequences.delete(writeSequence)
        resolveWriteSettledWaiters()
      })
    pendingWritePersistences.add(persisted)
  }

  const trackWritePersistence = (
    transaction: EntityWriteTransaction,
    autoCommit: boolean,
    debugOrigin: string
  ): EntityWriteTransaction => {
    let tracked = false

    const startTracking = (): void => {
      if (tracked) {
        return
      }
      tracked = true
      trackPersistencePromise(transaction.isPersisted.promise, debugOrigin)
    }

    const trackedTransaction = transaction as EntityWriteTransaction & {
      commit?: () => Promise<unknown>
      mutate?: (...args: Array<unknown>) => unknown
    }
    const originalMutate = trackedTransaction.mutate
    if (typeof originalMutate === `function`) {
      trackedTransaction.mutate = ((...args: Array<unknown>) => {
        startTracking()
        return originalMutate.apply(trackedTransaction, args)
      }) as typeof originalMutate
    }

    if (autoCommit) {
      return transaction
    }

    const originalCommit = trackedTransaction.commit
    if (typeof originalCommit === `function`) {
      trackedTransaction.commit = (() => {
        startTracking()
        return originalCommit.call(trackedTransaction)
      }) as typeof originalCommit
    }

    return transaction
  }

  const createWriteTransaction = (opts?: {
    autoCommit?: boolean
    debugOrigin?: string
  }): EntityWriteTransaction => {
    const autoCommit = opts?.autoCommit ?? true
    const debugOrigin =
      opts?.debugOrigin ??
      (autoCommit ? `write-transaction:auto` : `write-transaction:manual`)
    const transaction = createTransaction<Record<string, unknown>>({
      autoCommit,
      mutationFn: async ({ transaction }) => {
        await persistMutations(
          transaction.mutations as Array<PendingStateMutation>,
          (txid) => replayDb.utils.awaitTxId(txid, WRITE_TXID_TIMEOUT_MS)
        )
      },
    })
    return trackWritePersistence(transaction, autoCommit, debugOrigin)
  }

  const replaceDraft = (
    draft: object,
    nextRow: Record<string, unknown>
  ): void => {
    const record = draft as Record<string, unknown>
    for (const key of Object.keys(record)) {
      delete record[key]
    }
    Object.assign(record, nextRow)
  }

  const materializeEventRow = (
    event: ChangeEvent,
    primaryKey: string
  ): Record<string, unknown> => {
    if (typeof event.value !== `object` || event.value === null) {
      throw new Error(
        `[agent-runtime] Cannot apply ${event.type} ${event.headers.operation}: event value must be an object`
      )
    }

    return {
      ...(event.value as Record<string, unknown>),
      [primaryKey]: event.key,
    }
  }

  Object.assign(replayDb.utils, {
    createWriteTransaction,
    awaitWritesSettled: async () => {
      await Promise.resolve()
      const targetSequence = nextWriteSequence

      if (!hasBlockingWrite(targetSequence)) {
        const persistenceError = takeWritePersistenceErrorUpTo(targetSequence)
        if (persistenceError) {
          throw persistenceError
        }
        return
      }

      await new Promise<void>((resolve) => {
        const waiter = { targetSequence, resolve }
        writeSettledWaiters.add(waiter)
        resolveWriteSettledWaiters()
      })

      const persistenceError = takeWritePersistenceErrorUpTo(targetSequence)
      if (persistenceError) {
        throw persistenceError
      }
    },
    drainPendingWrites: async () => {
      const targetSequence = nextWriteSequence
      await Promise.allSettled([...pendingWritePersistences])
      const persistenceError = takeWritePersistenceErrorUpTo(targetSequence)
      if (persistenceError) {
        throw persistenceError
      }
    },
    applyEvent: (event: ChangeEvent): EntityWriteTransaction => {
      const collectionName = collectionNameByEventType.get(event.type)
      if (!collectionName) {
        throw new Error(
          `[agent-runtime] Unknown collection type "${event.type}" for applyEvent`
        )
      }

      const collection = replayDb.collections[collectionName]
      if (!collection) {
        throw new Error(
          `[agent-runtime] Missing collection "${collectionName}" for applyEvent`
        )
      }
      const primaryKey = mergedCollections[collectionName]!.primaryKey
      if (
        event.headers.operation !== `delete` &&
        typeof event.value === `object` &&
        event.value !== null
      ) {
        const orders = timelineOrdersByCollection.get(collectionName)
        // applyEvent stages an in-process event (not delivered through
        // a wire batch). It carries a single event, so the pointer's
        // sub-offset is always 1 ("the one item past this anchor").
        // If no real offset is available, synthesize a monotonically-
        // increasing `local:...` token so successive applyEvent calls
        // still sort in invocation order.
        const offset =
          event.headers.offset ??
          `local:${Date.now().toString().padStart(13, `0`)}`
        const pointer: EventPointer = { offset, subOffset: 1 }
        const order = orders?.get(event.key) ?? formatPointerOrderToken(pointer)
        orders?.set(event.key, order)
        ;(event.value as Record<string, unknown>)._timeline_order = order
        const principalColumn = principalColumnByCollection.get(collectionName)
        if (principalColumn) {
          const principal = (event.headers as Record<string, unknown>).principal
          if (principal !== undefined) {
            ;(event.value as Record<string, unknown>)[principalColumn] =
              principal
          }
        }
      }
      const transaction = createWriteTransaction({
        debugOrigin: `apply-event:${event.type}:${event.headers.operation}`,
      })

      transaction.mutate(() => {
        const operation = event.headers.operation
        if (operation === `delete`) {
          collection.delete(event.key)
          return
        }

        const row = materializeEventRow(event, primaryKey)
        if (operation === `insert`) {
          collection.insert(row)
          return
        }

        if (operation === `upsert`) {
          if (collection.has(event.key)) {
            collection.update(event.key, (draft) => replaceDraft(draft, row))
          } else {
            collection.insert(row)
          }
          return
        }

        if (collection.has(event.key)) {
          collection.update(event.key, (draft) => replaceDraft(draft, row))
          return
        }

        // Local optimistic events can arrive faster than a prior insert commit;
        // treat missing-row updates as insertions so repeated in-process runs
        // do not fail on transient ordering gaps.
        collection.insert(row)
      })

      return transaction
    },
  } satisfies EntityWriteUtils)

  for (const collection of Object.values(replayDb.collections)) {
    collection.__electricSourceDb = replayDb
    collection.__electricSourceId = streamUrl
  }

  for (const [actionName, actionFn] of Object.entries(replayDb.actions)) {
    replayDb.actions[actionName] = ((...args: Array<unknown>) => {
      const transaction = (actionFn as (...a: Array<unknown>) => unknown)(
        ...args
      )
      const persistence = (
        transaction as { isPersisted?: { promise?: Promise<unknown> } } | null
      )?.isPersisted?.promise
      if (persistence) {
        trackPersistencePromise(persistence, `action:${actionName}`)
      }
      return transaction
    }) as typeof actionFn
  }

  for (const [collectionName, collection] of Object.entries(
    replayDb.collections
  )) {
    collection.__electricRowOffsets = rowOffsetsByCollection.get(collectionName)
    collection.__electricTimelineOrders =
      timelineOrdersByCollection.get(collectionName)
  }

  return db as EntityStreamDBWithActions
}
