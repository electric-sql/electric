import { hash } from 'ohash'
import {
  PromiseWithResolvers,
  QualifiedTablename,
  emptyPromise,
} from '../../util'
import { Shape } from './types'
import uniqWith from 'lodash.uniqwith'
import { SyncStatus } from '../../client/model/shapes'

interface RequestedSubscription {
  serverId?: string
  overshadowsFullKeys: string[]
  shapes: Shape[]
  shapeHash: string
  fullKey: string
}

type OnShapeSyncStatusUpdated = (key: string, status: SyncStatus) => void

type OptionalRecord<T> = Record<string, T | undefined>

export class ShapeManager {
  /** Uses a full key (hash + key) for indexing */
  private knownSubscriptions: OptionalRecord<RequestedSubscription> = {}

  /** Maps a key without hash to the full key of latest requested subscription */
  private requestedSubscriptions: OptionalRecord<string> = {}
  /** Maps a key without hash to the full key of latest active subscription */
  private activeSubscriptions: OptionalRecord<string> = {}
  /** Maps a key to the full key of requested but not done subscription */
  private unfulfilled: OptionalRecord<string> = {}

  private promises: Record<string, PromiseWithResolvers<void>> = {}
  private serverIds: Map<string, string> = new Map()
  private incompleteUnsubs: Set<string> = new Set()

  constructor(private onShapeSyncStatusUpdated?: OnShapeSyncStatusUpdated) {}

  /** Set internal state using a string returned from {@link ShapeManager#serialize}. */
  public initialize(serializedState: string): void {
    const { unfulfilled, active, known, unsubscribes } =
      JSON.parse(serializedState)
    this.knownSubscriptions = known
    this.unfulfilled = unfulfilled
    this.activeSubscriptions = active
    this.incompleteUnsubs = new Set(unsubscribes)
    this.serverIds = new Map(
      Object.values(this.knownSubscriptions).flatMap((x) =>
        x?.serverId ? [[x.serverId, x.fullKey]] : []
      )
    )
    this.promises = {}
    this.requestedSubscriptions = {}
  }

  /** Serialize internal state for external storage. Can be later loaded with {@link ShapeManager#initialize} */
  public serialize(): string {
    return JSON.stringify({
      known: this.knownSubscriptions,
      unfulfilled: this.requestedSubscriptions,
      active: this.activeSubscriptions,
      unsubscribes: [...this.incompleteUnsubs],
    })
  }

  /** Reset internal state when the client is reset. Returns all tables that were touched by any of subscriptions. */
  public reset(opts: {
    reestablishSubscribed?: boolean
    defaultNamespace: string
  }): QualifiedTablename[] {
    const requested = Object.values(this.requestedSubscriptions)

    const tables = getTableNamesForShapes(
      Object.values(this.knownSubscriptions)
        .filter((x) => !requested.includes(x?.fullKey))
        .flatMap((x) => x?.shapes)
        .filter(onlyDefined),
      opts.defaultNamespace
    )

    let newKnown: OptionalRecord<RequestedSubscription> = {}
    let unfulfilled: OptionalRecord<string> = {}

    if (opts?.reestablishSubscribed) {
      // We'll be taking only the latest for each key
      const relevant = Object.values({
        ...this.activeSubscriptions,
        ...this.requestedSubscriptions,
      })
        .map((x) => this.knownSubscriptions[x!]!)
        .map(
          (x) =>
            [splitFullKey(x.fullKey)[1], { ...x, serverId: undefined }] as const
        )

      newKnown = Object.fromEntries(relevant)
      unfulfilled = Object.fromEntries(relevant.map(([k, v]) => [k, v.fullKey]))
    }

    this.knownSubscriptions = newKnown
    this.requestedSubscriptions = {}
    this.activeSubscriptions = {}
    this.unfulfilled = unfulfilled
    this.promises = {}
    this.serverIds = new Map()
    this.incompleteUnsubs = new Set()

    return tables
  }

  // undefined | "requested" | "active" | "modifying" | "cancelling"

  public status(key: string): SyncStatus {
    const active = this.activeSubscriptions[key]
      ? this.knownSubscriptions[this.activeSubscriptions[key]!]!
      : undefined
    const requested = this.requestedSubscriptions[key]
      ? this.knownSubscriptions[this.requestedSubscriptions[key]!]!
      : undefined

    if (active && requested && requested.serverId)
      return {
        status: 'establishing',
        progress: 'receiving_data',
        serverId: requested.serverId,
        oldServerId: active.serverId,
      } as const
    else if (requested && requested.serverId)
      return {
        status: 'establishing',
        progress: 'receiving_data',
        serverId: requested.serverId,
      }
    else if (active && active?.overshadowsFullKeys.length !== 0)
      return {
        status: 'establishing',
        progress: 'removing_data',
        serverId: active.serverId!,
      } as const
    else if (active && this.incompleteUnsubs.has(active.serverId!))
      return { status: 'cancelling', serverId: active.serverId! }
    else if (active) return { status: 'active', serverId: active.serverId! }
    else return undefined
  }

  /** Get a list of established subscriptions we can continue on reconnection */
  public listContinuedSubscriptions(): string[] {
    return Object.values(this.activeSubscriptions).map(
      (x) => this.knownSubscriptions[x!]!.serverId!
    )
  }

  /**
   * List actions that still need to be made after a restart.
   *
   * This should be done after initializing, but before any additional sync requests.
   */
  public listPendingActions(): {
    subscribe: { key: string; shapes: Shape[] }[]
    unsubscribe: string[]
  } {
    return {
      subscribe: Object.entries(this.unfulfilled).map(([key, fullKey]) => ({
        key,
        shapes: this.knownSubscriptions[fullKey!]!.shapes,
      })),
      unsubscribe: Object.values(this.activeSubscriptions)
        .flatMap((x) => this.knownSubscriptions[x!]!.overshadowsFullKeys)
        .concat([...this.incompleteUnsubs]),
    }
  }

  /**
   * Store a request to sync a list of shapes.
   *
   * This should be done before any actual API requests in order to correctly deduplicate concurrent calls
   * using the same shape.
   *
   * A unique key can be used to identify the sync request. If duplicating sync requests with the same key
   * have been made in the past, then all previous ones will be unsubscribed as soon as this one is fulfilled.
   *
   * @param shapes List of shapes to be included in this sync call
   * @param key Unique key to identify the sync request by
   * @returns A stored promise object that should be resolved when data arrives
   */
  public syncRequested(
    shapes: Shape[],
    key?: string
  ):
    | { key: string; existing: Promise<void> }
    | {
        key: string
        setServerId: (id: string) => void
        syncFailed: () => void
        promise: Promise<void>
      } {
    const shapeHash = this.hashShapes(shapes)
    const keyOrHash = key ?? shapeHash
    /* Since multiple requests may have the same key, we'll need to differentiate them
     * based on both hash and key. We use `:` to join them because hash is base64 that
     * won't use this symbol. This is a poor man's tuple to use as an object key.
     */
    const fullKey = makeFullKey(shapeHash, keyOrHash)

    const sub = this.getLatestSubscription(keyOrHash)

    if (sub && sub.shapeHash === shapeHash) {
      // Known & latest subscription with same key and hash.
      // Return an in-flight promise if it's in flight, or a resolved one if not
      return {
        key: keyOrHash,
        existing: this.promises[fullKey]?.promise ?? Promise.resolve(),
      }
    } else {
      let overshadowsFullKeys: string[] = []

      if (sub !== undefined) {
        // A known subscription with same key, but with a different hash
        // This means we'll be unsubscribing any previous subscriptions
        // NOTE: order matters here, we depend on it in `syncFailed`.
        overshadowsFullKeys = [sub.fullKey, ...sub.overshadowsFullKeys]
      }

      this.knownSubscriptions[fullKey] = {
        shapes,
        shapeHash,
        overshadowsFullKeys,
        fullKey,
      }

      this.requestedSubscriptions[keyOrHash] = fullKey

      let notified = false

      this.promises[fullKey] = emptyPromise()
      return {
        key: keyOrHash,
        setServerId: (id) => {
          this.setServerId(fullKey, id)
          if (!notified) {
            notified = true
            this.onShapeSyncStatusUpdated?.(keyOrHash, this.status(keyOrHash))
          }
        },
        syncFailed: () => this.syncFailed(keyOrHash, fullKey),
        promise: this.promises[fullKey].promise,
      }
    }
  }

  private syncFailed(key: string, fullKey: string): void {
    delete this.promises[fullKey]
    const sub = this.knownSubscriptions[fullKey]!

    // We're storing full keys of any subscriptions we were meant to unsubscribe from
    // in `sub.overshadowsFullKeys`, with last subscription's key being the first element.
    // If that last subscription is a requested subscription that still may arrive
    // (i.e. not active), then we're falling back to it so that previous sync call is not
    // invalidated by this one.
    const shadowedKey: string | undefined = sub.overshadowsFullKeys[0]
    if (
      shadowedKey &&
      this.requestedSubscriptions[key] === fullKey &&
      this.activeSubscriptions[key] != shadowedKey
    ) {
      this.requestedSubscriptions[key] = shadowedKey
    } else if (this.requestedSubscriptions[key] === fullKey) {
      delete this.requestedSubscriptions[key]
    }
    delete this.knownSubscriptions[fullKey]
  }

  /** Return latest known subscription for the key - requested first, active next. */
  private getLatestSubscription(
    key: string
  ): RequestedSubscription | undefined {
    const fullKey =
      this.requestedSubscriptions[key] ?? this.activeSubscriptions[key]

    return fullKey ? this.knownSubscriptions[fullKey] : undefined
  }

  private setServerId(fullKey: string, id: string) {
    this.knownSubscriptions[fullKey]!.serverId ??= id
    this.serverIds.set(this.knownSubscriptions[fullKey]!.serverId!, fullKey)
  }

  /**
   * Mark the subscription as delivered and resolve waiting promises.
   *
   * If the delivered subscription was overshadowing some other previous subscriptions,
   * the `synced` promise will not be resolved until the unsubscribe was successfully issued.
   */
  public dataDelivered(serverId: string): () => string[] {
    const fullKey = this.serverIds.get(serverId)
    if (fullKey === undefined || this.knownSubscriptions[fullKey] === undefined)
      throw new Error('Data received for an unknown subscription')

    const [_hash, key] = splitFullKey(fullKey)
    const sub = this.knownSubscriptions[fullKey]!

    if (this.requestedSubscriptions[key] === fullKey)
      delete this.requestedSubscriptions[key]
    this.activeSubscriptions[key] = fullKey

    if (sub.overshadowsFullKeys.length === 0) {
      this.onShapeSyncStatusUpdated?.(key, this.status(key))
      return () => {
        this.promises[fullKey].resolve()
        delete this.promises[fullKey]
        return []
      }
    } else {
      const ids = sub.overshadowsFullKeys
        .map((x) => this.knownSubscriptions[x]?.serverId)
        .filter(onlyDefined)
      return () => ids
    }
  }

  public unsubscribeMade(serverIds: string[]) {
    for (const id of serverIds) {
      this.incompleteUnsubs.add(id)

      if (this.onShapeSyncStatusUpdated) {
        const key = this.getKeyForServerID(id)
        if (!key) continue
        this.onShapeSyncStatusUpdated(key, this.status(key))
      }
    }
  }

  /**
   * Mark a GONE batch as received from the server after an unsubscribe.
   *
   */
  public goneBatchDelivered(serverIds: string[]) {
    for (const id of serverIds) {
      const fullKey = this.serverIds.get(id)
      if (fullKey === undefined) continue

      const [_hash, key] = splitFullKey(fullKey)
      delete this.knownSubscriptions[fullKey]
      this.serverIds.delete(id)
      this.incompleteUnsubs.delete(id)
      if (this.activeSubscriptions[key] === fullKey)
        delete this.activeSubscriptions[key]

      for (const sub of this.getSubscriptionsWaitingForUnsub(fullKey)) {
        sub.overshadowsFullKeys.splice(
          sub.overshadowsFullKeys.indexOf(fullKey),
          1
        )

        if (
          sub.overshadowsFullKeys.length === 0 &&
          this.activeSubscriptions[key] == sub.fullKey
        ) {
          this.promises[sub.fullKey].resolve()
        }
      }

      this.onShapeSyncStatusUpdated?.(key, this.status(key))
    }
  }

  private getSubscriptionsWaitingForUnsub(
    fullKey: string
  ): RequestedSubscription[] {
    return Object.values(this.knownSubscriptions)
      .filter(onlyDefined)
      .filter((x) => x.overshadowsFullKeys.some((y) => y === fullKey))
  }

  public getOnFailureCallback(serverId: string) {
    const fullKey = this.serverIds.get(serverId)
    return fullKey ? this.promises[fullKey]?.reject : undefined
  }

  public getServerIDs(keys: string[]): string[] {
    return keys
      .map((k) => this.activeSubscriptions[k])
      .map((k) => (k !== undefined ? this.knownSubscriptions[k] : k))
      .map((x) => (x ? x.serverId : x))
      .filter(onlyDefined)
  }

  public getServerIDsForShapes(shapes: Shape[]): string[] {
    const shapeHash = this.hashShapes(shapes)
    const fullKey = makeFullKey(shapeHash, shapeHash)
    const serverId = this.knownSubscriptions[fullKey]?.serverId
    return serverId ? [serverId] : []
  }

  public getKeyForServerID(serverId: string): string | undefined {
    const fullKey = this.serverIds.get(serverId)
    if (fullKey === undefined) return
    const [_hash, key] = splitFullKey(fullKey)
    return key
  }

  public hashShapes(shapes: Shape[]): string {
    // TODO: This sorts the shapes objects for hashing to make sure that order of includes
    //       does not affect the hash. This has the unfortunate consequence of sorting the FK spec,
    //       but the chance of a table having two multi-column FKs over same columns BUT in a
    //       different order feels much lower than people using includes in an arbitrary order.
    return hash(shapes, { unorderedArrays: true })
  }
}

function onlyDefined<T>(x: T | undefined): x is T {
  return x !== undefined
}

function makeFullKey(hash: string, key: string): string {
  return hash + ':' + key
}

function splitFullKey(fullKey: string): [hash: string, key: string] {
  return splitOnce(fullKey, ':')
}

function splitOnce(str: string, on: string): [string, string] {
  const found = str.indexOf(on)
  if (found === -1) return [str, '']
  else return [str.slice(0, found), str.slice(found + 1)]
}

export function getTableNamesForShapes(
  shapes: Shape[],
  schema: string
): QualifiedTablename[] {
  return uniqWith(
    shapes.flatMap((x) => doGetTableNamesForShape(x, schema)),
    (a, b) => a.isEqual(b)
  )
}

function doGetTableNamesForShape(
  shape: Shape,
  schema: string
): QualifiedTablename[] {
  const includes =
    shape.include?.flatMap((x) => doGetTableNamesForShape(x.select, schema)) ??
    []
  includes.push(new QualifiedTablename(schema, shape.tablename))
  return includes
}
