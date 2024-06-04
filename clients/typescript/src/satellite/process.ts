import throttle from 'lodash.throttle'

import {
  SatOpMigrate_Type,
  SatRelation_RelationType,
} from '../_generated/protocol/satellite'
import { AuthConfig, AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import {
  AuthStateNotification,
  Change,
  ChangeOrigin,
  Notifier,
  UnsubscribeFunction,
} from '../notifiers/index'
import { Waiter, getWaiter } from '../util/common'
import { base64, bytesToNumber } from '../util/encoders'
import { QualifiedTablename } from '../util/tablename'
import {
  AdditionalData,
  ConnectivityState,
  ConnectivityStatus,
  DataChange,
  DbName,
  LSN,
  MigrationTable,
  Relation,
  RelationsCache,
  ReplicationStatus,
  SatelliteError,
  SatelliteErrorCode,
  SchemaChange,
  SqlValue,
  Statement,
  Transaction,
  isDataChange,
  Uuid,
  DbRecord as DataRecord,
  ReplicatedRowTransformer,
  DataGone,
  ServerTransaction,
} from '../util/types'
import { SatelliteOpts } from './config'
import { Client, Satellite } from './index'
import {
  OPTYPES,
  OplogEntry,
  ShadowEntry,
  ShadowEntryChanges,
  encodeTags,
  extractPK,
  fromTransaction,
  generateTag,
  getShadowPrimaryKey,
  primaryKeyToStr,
  toTransactions,
} from './oplog'

import { Mutex } from 'async-mutex'
import Log from 'loglevel'
import { generateTableTriggers } from '../migrators/triggers'
import { mergeEntries } from './merge'
import {
  Shape,
  InitialDataChange,
  SubscribeResponse,
  SubscriptionData,
} from './shapes/types'
import { backOff } from 'exponential-backoff'
import { chunkBy, genUUID } from '../util'
import { isFatal, isOutOfSyncError, isThrowable, wrapFatalError } from './error'
import { inferRelationsFromDb } from '../util/relations'
import { decodeUserIdFromToken } from '../auth/secure'
import { InvalidArgumentError } from '../client/validation/errors/invalidArgumentError'
import Long from 'long'
import { QueryBuilder } from '../migrators/query-builder'
import groupBy from 'lodash.groupby'
import { ShapeManager } from './shapes/shapeManager'
import { SyncStatus } from '../client/model/shapes'

type ChangeAccumulator = {
  [key: string]: Change
}

export type ShapeSubscription = {
  key: string
  synced: Promise<void>
}

type ThrottleFunction = {
  cancel: () => void
  (): Promise<Date> | undefined
}

type MetaEntries = {
  clientId: Uuid | ''
  compensations: number
  lsn: string | null
  subscriptions: string
  seenAdditionalData: string
  seenGoneBatch: string
}

type ConnectRetryHandler = (error: Error, attempt: number) => boolean
const connectRetryHandler: ConnectRetryHandler = (error) => {
  if (
    !(error instanceof SatelliteError) ||
    isThrowable(error) ||
    isFatal(error)
  ) {
    Log.debug(`connectAndStartRetryHandler was cancelled: ${error.message}`)
    return false
  }
  return true
}

export class SatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  client: Client
  builder: QueryBuilder

  opts: SatelliteOpts

  _authState?: AuthState
  _unsubscribeFromAuthState?: UnsubscribeFunction

  connectivityState?: ConnectivityState
  _unsubscribeFromConnectivityChanges?: UnsubscribeFunction

  _pollingInterval?: any
  _unsubscribeFromPotentialDataChanges?: UnsubscribeFunction
  _throttledSnapshot: ThrottleFunction

  _lsn?: LSN

  relations: RelationsCache

  previousShapeSubscriptions: { keY: string; shapes: Shape[] }[]
  subscriptionManager: ShapeManager

  /**
   * To optimize inserting a lot of data when the subscription data comes, we need to do
   * less `INSERT` queries, but SQLite/Postgres support only a limited amount of `?`/`$i` positional
   * arguments. Precisely, its either 999 for SQLite versions prior to 3.32.0 and 32766 for
   * versions after, and 65535 for Postgres.
   */
  private maxSqlParameters: 999 | 32766 | 65535 = 999
  private snapshotMutex: Mutex = new Mutex()
  private performingSnapshot = false

  private _connectRetryHandler: ConnectRetryHandler
  private initializing?: Waiter

  private _removeClientListeners?: () => void

  constructor(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    client: Client,
    opts: SatelliteOpts
  ) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.client = client
    this.builder = this.migrator.queryBuilder

    this.opts = opts
    this.relations = {}

    this.previousShapeSubscriptions = []
    this.subscriptionManager = new ShapeManager(
      this.notifier.shapeSubscriptionSyncStatusChanged.bind(
        this.notifier,
        this.dbName
      )
    )

    this._throttledSnapshot = throttle(
      this._mutexSnapshot.bind(this),
      opts.minSnapshotWindow,
      {
        leading: true,
        trailing: true,
      }
    )

    this._connectRetryHandler = connectRetryHandler
  }

  /**
   * Perform a snapshot while taking out a mutex to avoid concurrent calls.
   */
  async _mutexSnapshot() {
    const release = await this.snapshotMutex.acquire()
    try {
      return await this._performSnapshot()
    } finally {
      release()
    }
  }

  async start(authConfig?: AuthConfig): Promise<void> {
    if (this.opts.debug) {
      await this.logDatabaseVersion()
    }

    this.setClientListeners()

    await this.migrator.up()

    const isVerified = await this._verifyTableStructure()
    if (!isVerified) {
      throw new Error('Invalid database schema.')
    }

    const clientId =
      authConfig?.clientId && authConfig.clientId !== ''
        ? authConfig.clientId
        : await this._getClientId()
    this._setAuthState({ clientId: clientId })

    const notifierSubscriptions = Object.entries({
      _authStateSubscription: this._unsubscribeFromAuthState,
      _connectivityChangeSubscription: this._unsubscribeFromConnectivityChanges,
      _potentialDataChangeSubscription:
        this._unsubscribeFromPotentialDataChanges,
    })
    notifierSubscriptions.forEach(([name, value]) => {
      if (value !== undefined) {
        throw new Error(
          `Starting satellite process with an existing
           \`${name}\`.
           This means there is a notifier subscription leak.`
        )
      }
    })

    // Monitor auth state changes.
    const authStateHandler = this._updateAuthState.bind(this)
    this._unsubscribeFromAuthState =
      this.notifier.subscribeToAuthStateChanges(authStateHandler)

    // Request a snapshot whenever the data in our database potentially changes.
    this._unsubscribeFromPotentialDataChanges =
      this.notifier.subscribeToPotentialDataChanges(this._throttledSnapshot)

    // Start polling to request a snapshot every `pollingInterval` ms.
    clearInterval(this._pollingInterval)
    this._pollingInterval = setInterval(
      this._throttledSnapshot,
      this.opts.pollingInterval
    )

    // Starting now!
    await this._throttledSnapshot()

    // Need to reload primary keys after schema migration
    this.relations = await this._getLocalRelations()
    this.checkMaxSqlParameters()

    const lsnBase64 = await this._getMeta('lsn')
    if (lsnBase64 && lsnBase64.length > 0) {
      this._lsn = base64.toBytes(lsnBase64)
      Log.info(`retrieved lsn ${this._lsn}`)
    } else {
      Log.info(`no lsn retrieved from store`)
    }

    const subscriptionsState = await this._getMeta('subscriptions')
    if (subscriptionsState) {
      // this.subscriptions.setState(subscriptionsState)
      this.subscriptionManager.initialize(subscriptionsState)
    }
  }

  private async logDatabaseVersion(): Promise<void> {
    const versionRow = await this.adapter.query({
      sql: this.builder.getVersion,
    })
    Log.info(
      `Using ${this.builder.dialect} version: ${versionRow[0]['version']}`
    )
  }

  _setAuthState(authState: AuthState): void {
    this._authState = authState
  }

  // Adds all the necessary listeners to the satellite client
  // They can be cleared up by calling the function `_removeClientListeners`
  setClientListeners(): void {
    // Remove any existing listeners
    if (this._removeClientListeners) {
      this._removeClientListeners?.()
      this._removeClientListeners = undefined
    }

    const clientErrorCallback = this._handleClientError.bind(this)
    this.client.subscribeToError(clientErrorCallback)

    const clientRelationsCallback = this._handleClientRelations.bind(this)
    this.client.subscribeToRelations(clientRelationsCallback)

    const clientTransactionsCallback = this._handleClientTransactions.bind(this)
    this.client.subscribeToTransactions(clientTransactionsCallback)

    const clientAdditionalDataCallback =
      this._handleClientAdditionalData.bind(this)
    this.client.subscribeToAdditionalData(clientAdditionalDataCallback)

    const clientOutboundStartedCallback =
      this._handleClientOutboundStarted.bind(this)
    this.client.subscribeToOutboundStarted(clientOutboundStartedCallback)

    const clientGoneBatchCallback = this._applyGoneBatch.bind(this)
    this.client.subscribeToGoneBatch(clientGoneBatchCallback)

    const clientSubscriptionDataCallback =
      this._handleSubscriptionData.bind(this)
    const clientSubscriptionErrorCallback =
      this._handleSubscriptionError.bind(this)
    this.client.subscribeToSubscriptionEvents(
      clientSubscriptionDataCallback,
      clientSubscriptionErrorCallback
    )

    // Keep a way to remove the client listeners
    this._removeClientListeners = () => {
      this.client.unsubscribeToError(clientErrorCallback)
      this.client.unsubscribeToRelations(clientRelationsCallback)
      this.client.unsubscribeToTransactions(clientTransactionsCallback)
      this.client.unsubscribeToAdditionalData(clientAdditionalDataCallback)
      this.client.unsubscribeToOutboundStarted(clientOutboundStartedCallback)

      this.client.unsubscribeToSubscriptionEvents(
        clientSubscriptionDataCallback,
        clientSubscriptionErrorCallback
      )
      this.client.unsubscribeToGoneBatch(clientGoneBatchCallback)
    }
  }

  // Unsubscribe from data changes and stop polling
  async stop(shutdown?: boolean): Promise<void> {
    return this._stop(shutdown)
  }

  private async _stop(shutdown?: boolean): Promise<void> {
    // Stop snapshot polling
    clearInterval(this._pollingInterval)
    this._pollingInterval = undefined

    // Unsubscribe all listeners and remove them
    const unsubscribers = [
      '_unsubscribeFromAuthState',
      '_unsubscribeFromConnectivityChanges',
      '_unsubscribeFromPotentialDataChanges',
    ] as const

    unsubscribers.forEach((unsubscriber) => {
      const unsub = this[unsubscriber]
      if (unsub !== undefined) {
        unsub!()
        this[unsubscriber] = undefined
      }
    })

    this._removeClientListeners?.()
    this._removeClientListeners = undefined

    // Cancel the snapshot throttle
    this._throttledSnapshot.cancel()

    // Make sure no snapshot is running after we stop the process, otherwise we might be trying to
    // interact with a closed database connection
    await this._waitForActiveSnapshots()

    this.disconnect()

    if (shutdown) {
      await this.client.shutdown()
    }
  }

  // Ensure that no snapshot is left running in the background
  // by acquiring the mutex and releasing it immediately.
  async _waitForActiveSnapshots(): Promise<void> {
    const releaseMutex = await this.snapshotMutex.acquire()
    releaseMutex()
  }

  /** Get information about a requested subscription by it's key */
  public syncStatus(key: string): SyncStatus {
    return this.subscriptionManager.status(key)
  }

  /**
   * Subscribe to a set of shapes, so that server data can get onto the client.
   *
   * A set of shapes can be "named" using a key. Any subsequent calls to `subscribe`
   * using this key will exchange the subscription: a new one will be subscribed, and
   * then the old one will be unsubscribed.
   *
   * If the `key` is not provided, it will instead be generated. Un-keyed subscriptions
   * are deduplicated: multiple `subscribe` calls with exactly same shapes will result in
   * only one subscription, and will even return the same key.
   */
  async subscribe(
    shapeDefinitions: Shape[],
    key?: string
  ): Promise<ShapeSubscription> {
    // Await for client to be ready before doing anything else
    await this.initializing?.waitOn()

    return this._doSubscribe(shapeDefinitions, key)
  }

  /** Make a subscription without waiting for init */
  private async _doSubscribe(
    shapes: Shape[],
    key?: string
  ): Promise<ShapeSubscription> {
    const request = this.subscriptionManager.syncRequested(shapes, key)

    if ('existing' in request)
      return { key: request.key, synced: request.existing }

    const clearSubAndThrow = (error: any): never => {
      request.syncFailed()
      throw error
    }

    try {
      // We're not using generated subscription ID in code here because
      // it should become server-generated at some point.
      const { subscriptionId, error }: SubscribeResponse =
        await this.client.subscribe(
          genUUID(),
          shapes.map((x) => ({ definition: x, requestId: genUUID() }))
        )

      request.setServerId(subscriptionId)

      if (error) throw error

      // persist subscription metadata
      await this._setMeta('subscriptions', this.subscriptionManager.serialize())

      return {
        key: request.key,
        synced: request.promise,
      }
    } catch (error: any) {
      return clearSubAndThrow(error)
    }
  }

  public unsubscribe(sync: { shapes: Shape[]; key?: string }): Promise<void>
  public unsubscribe(keys: string[]): Promise<void>
  public unsubscribe(
    target: string[] | { shapes: Shape[]; key?: string }
  ): Promise<void> {
    if (Array.isArray(target)) {
      return this.unsubscribeIds(this.subscriptionManager.getServerIDs(target))
    } else if (target.key) {
      return this.unsubscribeIds(
        this.subscriptionManager.getServerIDs([target.key])
      )
    } else {
      return this.unsubscribeIds(
        this.subscriptionManager.getServerIDsForShapes(target.shapes)
      )
    }
  }

  private async unsubscribeIds(subscriptionIds: string[]): Promise<void> {
    if (subscriptionIds.length === 0) return

    await this.client.unsubscribe(subscriptionIds)

    // If the server didn't send an error, we persist the fact the subscription was deleted.
    this.subscriptionManager.unsubscribeMade(subscriptionIds)

    // persist subscription metadata
    await this.adapter.run(
      this._setMetaStatement(
        'subscriptions',
        this.subscriptionManager.serialize()
      )
    )
  }

  async _handleSubscriptionData(subsData: SubscriptionData): Promise<void> {
    const afterApply = this.subscriptionManager.dataDelivered(
      subsData.subscriptionId
    )

    const applied = await this._applySubscriptionData(
      subsData.data,
      subsData.lsn,
      [],
      subsData.subscriptionId
    )

    if (applied) {
      const toBeUnsubbed = afterApply()
      if (toBeUnsubbed.length > 0) await this.unsubscribeIds(toBeUnsubbed)
    }
  }

  /**
   * Insert incoming subscription data into the database.
   * Returns flag indicating whether application was successful or not.
   */
  private async _applySubscriptionData(
    changes: InitialDataChange[],
    lsn: LSN,
    additionalStmts: Statement[] = [],
    subscriptionId?: string
  ): Promise<boolean> {
    const namespace = this.builder.defaultNamespace
    const stmts: Statement[] = []

    // Defer (SQLite) or temporarily disable FK checks (Postgres)
    // because order of inserts may not respect referential integrity
    // and Postgres doesn't let us defer FKs
    // that were not originally defined as deferrable
    stmts.push({ sql: this.builder.deferOrDisableFKsForTx })

    // It's much faster[1] to do less statements to insert the data instead of doing an insert statement for each row
    // so we're going to do just that, but with a caveat: SQLite has a max number of parameters in prepared statements,
    // so this is less of "insert all at once" and more of "insert in batches". This should be even more noticeable with
    // WASM builds, since we'll be crossing the JS-WASM boundary less.
    //
    // [1]: https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2

    const groupedChanges = new Map<
      string,
      {
        relation: Relation
        records: InitialDataChange['record'][]
        table: QualifiedTablename
      }
    >()

    const allArgsForShadowInsert: Record<
      'namespace' | 'tablename' | 'primaryKey' | 'tags',
      SqlValue
    >[] = []

    // Group all changes by table name to be able to insert them all together
    for (const op of changes) {
      const qt = new QualifiedTablename(namespace, op.relation.table)
      const tableName = qt.toString()

      if (groupedChanges.has(tableName)) {
        groupedChanges.get(tableName)?.records.push(op.record)
      } else {
        groupedChanges.set(tableName, {
          relation: op.relation,
          records: [op.record],
          table: qt,
        })
      }

      // Since we're already iterating changes, we can also prepare data for shadow table
      const primaryKeyCols = op.relation.columns.reduce((agg, col) => {
        if (col.primaryKey)
          agg[col.name] = op.record[col.name] as string | number
        return agg
      }, {} as Record<string, string | number>)

      allArgsForShadowInsert.push({
        namespace,
        tablename: op.relation.table,
        primaryKey: primaryKeyToStr(primaryKeyCols),
        tags: encodeTags(op.tags),
      })
    }

    const qualifiedTableNames = [
      ...Array.from(groupedChanges.values()).map((chg) => chg.table),
    ]

    // Disable trigger for all affected tables
    stmts.push(...this._disableTriggers(qualifiedTableNames))

    // For each table, do a batched insert
    for (const [_table, { relation, records, table }] of groupedChanges) {
      const columnNames = relation.columns.map((col) => col.name)
      const qualifiedTableName = `${table}`
      const orIgnore = this.builder.sqliteOnly('OR IGNORE')
      const onConflictDoNothing = this.builder.pgOnly('ON CONFLICT DO NOTHING')
      const sqlBase = `INSERT ${orIgnore} INTO ${qualifiedTableName} (${columnNames.join(
        ', '
      )}) VALUES `
      // Must be an insert or ignore into

      stmts.push(
        ...this.builder.prepareInsertBatchedStatements(
          sqlBase,
          columnNames,
          records as Record<string, SqlValue>[],
          this.maxSqlParameters,
          onConflictDoNothing
        )
      )
    }

    // And re-enable the triggers for all of them
    stmts.push(...this._enableTriggers(qualifiedTableNames))

    // Then do a batched insert for the shadow table
    const batchedShadowInserts = this.builder.batchedInsertOrReplace(
      this.opts.shadowTable,
      ['namespace', 'tablename', 'primaryKey', 'tags'],
      allArgsForShadowInsert,
      ['namespace', 'tablename', 'primaryKey'],
      ['namespace', 'tablename', 'tags'],
      this.maxSqlParameters
    )
    stmts.push(...batchedShadowInserts)

    // Then update subscription state and LSN
    stmts.push(
      this._setMetaStatement(
        'subscriptions',
        this.subscriptionManager.serialize()
      ),
      this.updateLsnStmt(lsn),
      ...additionalStmts
    )

    try {
      await this.adapter.runInTransaction(...stmts)

      // We're explicitly not specifying rowids in these changes for now,
      // because nobody uses them and we don't have the machinery to to a
      // `RETURNING` clause in the middle of `runInTransaction`.
      const notificationChanges: Change[] = []

      groupedChanges.forEach(({ records, table, relation }) => {
        const primaryKeyColNames = relation.columns
          .filter((col) => col.primaryKey)
          .map((col) => col.name)
        notificationChanges.push({
          qualifiedTablename: table,
          rowids: [],
          recordChanges: records.map((change) => {
            return {
              primaryKey: Object.fromEntries(
                primaryKeyColNames.map((col_name) => {
                  return [col_name, change[col_name]]
                })
              ),
              type: 'INITIAL',
            }
          }),
        })
      })
      this.notifier.actuallyChanged(this.dbName, notificationChanges, 'initial')
      return true
    } catch (e) {
      this._handleSubscriptionError(
        new SatelliteError(
          SatelliteErrorCode.INTERNAL,
          `Error applying subscription data: ${(e as any).message}`
        ),
        subscriptionId
      )
      return false
    }
  }

  _resetClientState(opts?: { keepSubscribedShapes: boolean }): Promise<void> {
    Log.warn(`resetting client state`)
    this.disconnect()

    this._lsn = undefined

    const tables = this.subscriptionManager.reset({
      defaultNamespace: this.builder.defaultNamespace,
      reestablishSubscribed: opts?.keepSubscribedShapes,
    })

    return this._clearTables(tables)
  }

  async _clearTables(tables: QualifiedTablename[]) {
    await this.adapter.runInTransaction(
      this._setMetaStatement('lsn', null),
      this._setMetaStatement(
        'subscriptions',
        this.subscriptionManager.serialize()
      ),
      { sql: this.builder.deferOrDisableFKsForTx },
      ...this._disableTriggers(tables),
      ...tables.map((x) => ({ sql: `DELETE FROM ${x}` })),
      ...this._enableTriggers(tables)
    )
  }

  async _handleSubscriptionError(
    satelliteError: SatelliteError,
    subscriptionId?: string
  ): Promise<void> {
    Log.error('encountered a subscription error: ' + satelliteError.message)
    let resettingError: any = satelliteError
    let onFailure: ((reason?: any) => void) | undefined

    // We're pulling out the reject callback because we're about to reset the subscription manager
    if (subscriptionId)
      onFailure = this.subscriptionManager.getOnFailureCallback(subscriptionId)

    try {
      await this._resetClientState()
    } catch (error) {
      console.log(error)
      // If we encounter an error here, we want to float it to the client so that the bug is visible
      // instead of just a broken state.
      resettingError = error
      resettingError.stack +=
        '\n  Encountered when handling a subscription error: \n    ' +
        satelliteError.stack
    }
    // Call the `onFailure` callback for this subscription
    onFailure?.(resettingError)
  }

  _handleClientRelations(relation: Relation): void {
    this._updateRelations(relation)
  }

  async _handleClientTransactions(tx: ServerTransaction) {
    await this._applyTransaction(tx)
  }

  async _handleClientAdditionalData(data: AdditionalData) {
    await this._applyAdditionalData(data)
  }

  async _handleClientOutboundStarted() {
    await this._throttledSnapshot()
  }

  // handles async client errors: can be a socket error or a server error message
  _handleClientError(satelliteError: SatelliteError) {
    if (this.initializing && !this.initializing.finished()) {
      if (satelliteError.code === SatelliteErrorCode.SOCKET_ERROR) {
        Log.warn(
          `a socket error occurred while connecting to server: ${satelliteError.message}`
        )
        return
      }

      if (satelliteError.code === SatelliteErrorCode.AUTH_REQUIRED) {
        // TODO: should stop retrying
        Log.warn(
          `an authentication error occurred while connecting to server: ${satelliteError.message}`
        )
        return
      }

      // throw unhandled error
      throw satelliteError
    }

    Log.warn(`an error occurred in satellite: ${satelliteError.message}`)

    this._handleOrThrowClientError(satelliteError)
  }

  async _handleOrThrowClientError(error: SatelliteError): Promise<void> {
    if (error.code === SatelliteErrorCode.AUTH_EXPIRED) {
      Log.warn('Connection closed by Electric because the JWT expired.')
      return this.disconnect(
        new SatelliteError(
          error.code,
          'Connection closed by Electric because the JWT expired.'
        )
      )
    }

    this.disconnect(error)

    if (isThrowable(error)) {
      throw error
    }
    if (isFatal(error)) {
      throw wrapFatalError(error)
    }

    Log.warn('Client disconnected with a non fatal error, reconnecting')
    return this.connectWithBackoff()
  }

  /**
   * Sets the JWT token.
   * @param token The JWT token.
   */
  setToken(token: string): void {
    const newUserId = decodeUserIdFromToken(token)
    const userId: string | undefined = this._authState?.userId
    if (typeof userId !== 'undefined' && newUserId !== userId) {
      // We must check that the new token is still using the same user ID.
      // We can't accept a re-connection that changes the user ID because the Satellite process is statefull.
      // To change user ID the user must re-electrify the database.
      throw new InvalidArgumentError(
        `Can't change user ID when reconnecting. Previously connected with user ID '${userId}' but trying to reconnect with user ID '${newUserId}'`
      )
    }
    this._setAuthState({
      ...this._authState!,
      userId: newUserId,
      token,
    })
  }

  /**
   * @returns True if a JWT token has been set previously. False otherwise.
   */
  hasToken(): boolean {
    return this._authState?.token !== undefined
  }

  async connectWithBackoff(): Promise<void> {
    if (this.client.isConnected()) {
      // we're already connected
      return
    }

    if (this.initializing && !this.initializing.finished()) {
      // we're already trying to connect to Electric
      // return the promise that resolves when the connection is established
      return this.initializing.waitOn()
    }

    if (!this.initializing || this.initializing?.finished()) {
      this.initializing = getWaiter()
    }

    const opts = {
      ...this.opts.connectionBackOffOptions,
      retry: this._connectRetryHandler,
    }

    const prom = this.initializing.waitOn()

    await backOff(async () => {
      if (this.initializing?.finished()) {
        return prom
      }
      await this._connect()
      await this._startReplication()
      await this._makePendingSubscriptions()
      // this._subscribePreviousShapeRequests()

      this._notifyConnectivityState('connected')
      this.initializing?.resolve()
    }, opts).catch((e) => {
      // We're very sure that no calls are going to modify `this.initializing` before this promise resolves
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const error = !connectRetryHandler(e, 0)
        ? e
        : new SatelliteError(
            SatelliteErrorCode.CONNECTION_FAILED_AFTER_RETRY,
            `Failed to connect to server after exhausting retry policy. Last error thrown by server: ${e.message}`
          )

      this.disconnect(error)
      this.initializing?.reject(error)
    })

    return prom
  }

  private async _makePendingSubscriptions(): Promise<void> {
    const { subscribe, unsubscribe } =
      this.subscriptionManager.listPendingActions()

    await this.unsubscribeIds(unsubscribe)
    await Promise.all(subscribe.map((x) => this._doSubscribe(x.shapes, x.key)))
  }

  // _subscribePreviousShapeRequests(): void {
  //   try {
  //     if (this.previousShapeSubscriptions.length > 0) {
  //       Log.warn(`Subscribing previous shape definitions`)
  //       this.subscribe(
  //         this.previousShapeSubscriptions.splice(
  //           0,
  //           this.previousShapeSubscriptions.length
  //         )
  //       )
  //     }
  //   } catch (error: any) {
  //     const message = `Client was unable to subscribe previously subscribed shapes: ${error.message}`
  //     throw new SatelliteError(SatelliteErrorCode.INTERNAL, message)
  //   }
  // }

  // NO DIRECT CALLS TO CONNECT
  private async _connect(): Promise<void> {
    Log.info(`connecting to electric server`)

    if (!this._authState || !this._authState.token) {
      throw new Error(`trying to connect before authentication`)
    }

    try {
      await this.client.connect()
      await this.authenticate(this._authState!.token!)
    } catch (error: any) {
      Log.debug(
        `server returned an error while establishing connection: ${error.message}`
      )
      throw error
    }
  }

  /**
   * Authenticates with the Electric sync service using the provided token.
   * @returns A promise that resolves to void if authentication succeeded. Otherwise, rejects with the reason for the error.
   */
  async authenticate(token: string): Promise<void> {
    const authState = {
      clientId: this._authState!.clientId,
      token,
    }
    const authResp = await this.client.authenticate(authState)
    if (authResp.error) {
      throw authResp.error
    }
    this._setAuthState(authState)
  }

  cancelConnectionWaiter(error: SatelliteError): void {
    if (this.initializing && !this.initializing.finished()) {
      this.initializing?.reject(error)
    }
  }

  disconnect(error?: SatelliteError): void {
    this.client.disconnect()
    this._notifyConnectivityState('disconnected', error)
  }

  /**
   * A disconnection issued by the client.
   */
  clientDisconnect(): void {
    const error = new SatelliteError(
      SatelliteErrorCode.CONNECTION_CANCELLED_BY_DISCONNECT,
      `Connection cancelled by 'disconnect'`
    )
    this.disconnect(error)
    this.cancelConnectionWaiter(error)
  }

  async _startReplication(): Promise<void> {
    try {
      const schemaVersion = await this.migrator.querySchemaVersion()

      // Load subscription state that to reset the subscription manager correctly
      const subscriptionsState = await this._getMeta('subscriptions')
      if (subscriptionsState) {
        this.subscriptionManager.initialize(subscriptionsState)
      }

      // Fetch the subscription IDs that were fulfilled
      // such that we can resume and inform Electric
      // about fulfilled subscriptions
      const subscriptionIds =
        this.subscriptionManager.listContinuedSubscriptions()
      const observedTransactionData = await this._getMeta('seenAdditionalData')

      const { error } = await this.client.startReplication(
        this._lsn,
        schemaVersion,
        subscriptionIds.length > 0 ? subscriptionIds : undefined,
        observedTransactionData
          .split(',')
          .filter((x) => x !== '')
          .map((x) => Long.fromString(x))
      )

      if (error) {
        throw error
      }
    } catch (error: any) {
      Log.warn(`Couldn't start replication: ${error.message}`)
      if (!(error instanceof SatelliteError)) {
        throw new SatelliteError(SatelliteErrorCode.INTERNAL, error.message)
      }

      if (isOutOfSyncError(error) && this.opts?.clearOnBehindWindow) {
        await this._resetClientState({ keepSubscribedShapes: true })
        throw error
      }

      // Some errors could be fixed by dropping local database entirely
      // We propagate throwable and fatal errors for the app to decide
      if (isThrowable(error)) {
        throw error
      }

      if (isFatal(error)) {
        throw wrapFatalError(error)
      }
    }
  }

  private _notifyConnectivityState(
    connectivityStatus: ConnectivityStatus,
    error?: SatelliteError
  ): void {
    this.connectivityState = {
      status: connectivityStatus,
      reason: error,
    }
    this.notifier.connectivityStateChanged(this.dbName, this.connectivityState)
  }

  async _verifyTableStructure(): Promise<boolean> {
    const meta = this.opts.metaTable.tablename
    const oplog = this.opts.oplogTable.tablename
    const shadow = this.opts.shadowTable.tablename

    const [{ count }] = await this.adapter.query(
      this.builder.countTablesIn([meta, oplog, shadow])
    )
    return count === 3
  }

  // Handle auth state changes.
  async _updateAuthState({ authState }: AuthStateNotification): Promise<void> {
    // XXX do whatever we need to stop/start or reconnect the replication
    // connection with the new auth state.

    // XXX Maybe we need to auto-start processing and/or replication
    // when we get the right authState?

    this._authState = authState
  }

  // Perform a snapshot and notify which data actually changed.
  // It is not safe to call concurrently. Use mutexSnapshot.
  async _performSnapshot(): Promise<Date> {
    // assert a single call at a time
    if (this.performingSnapshot) {
      throw new SatelliteError(
        SatelliteErrorCode.INTERNAL,
        'already performing snapshot'
      )
    } else {
      this.performingSnapshot = true
    }

    try {
      const oplog = `${this.opts.oplogTable}`
      const shadow = `${this.opts.shadowTable}`
      const timestamp = new Date()
      const newTag = this._generateTag(timestamp)

      /*
       * IMPORTANT!
       *
       * The following queries make use of a documented but rare SQLite behaviour that allows selecting bare column
       * on aggregate queries: https://sqlite.org/lang_select.html#bare_columns_in_an_aggregate_query
       *
       * In short, when a query has a `GROUP BY` clause with a single `min()` or `max()` present in SELECT/HAVING,
       * then the "bare" columns (i.e. those not mentioned in a `GROUP BY` clause) are definitely the ones from the
       * row that satisfied that `min`/`max` function. We make use of it here to find first/last operations in the
       * oplog that touch a particular row.
       */

      // Update the timestamps on all "new" entries - they have been added but timestamp is still `NULL`
      const q1: Statement = {
        sql: `
      UPDATE ${oplog} SET timestamp = ${this.builder.makePositionalParam(1)}
      WHERE rowid in (
        SELECT rowid FROM ${oplog}
            WHERE timestamp is NULL
        ORDER BY rowid ASC
        )
      RETURNING *
      `,
        args: [timestamp.toISOString()],
      }

      // We're adding new tag to the shadow tags for this row
      const q2: Statement = {
        sql: `
      UPDATE ${oplog}
      SET "clearTags" =
          CASE WHEN shadow.tags = '[]' OR shadow.tags = ''
               THEN '["' || ${this.builder.makePositionalParam(1)} || '"]'
               ELSE '["' || ${this.builder.makePositionalParam(
                 2
               )} || '",' || substring(shadow.tags, 2)
          END
      FROM ${shadow} AS shadow
      WHERE ${oplog}.namespace = shadow.namespace
          AND ${oplog}.tablename = shadow.tablename
          AND ${oplog}."primaryKey" = shadow."primaryKey" AND ${oplog}.timestamp = ${this.builder.makePositionalParam(
          3
        )}
      `,
        args: [newTag, newTag, timestamp.toISOString()],
      }

      // For each affected shadow row, set new tag array, unless the last oplog operation was a DELETE
      const q3: Statement = {
        sql: this.builder.setTagsForShadowRows(
          this.opts.oplogTable,
          this.opts.shadowTable
        ),
        args: [encodeTags([newTag]), timestamp.toISOString()],
      }

      // And finally delete any shadow rows where the last oplog operation was a `DELETE`
      const q4: Statement = {
        sql: this.builder.removeDeletedShadowRows(
          this.opts.oplogTable,
          this.opts.shadowTable
        ),
        args: [timestamp.toISOString()],
      }

      // Execute the four queries above in a transaction, returning the results from the first query
      // We're dropping down to this transaction interface because `runInTransaction` doesn't allow queries
      const oplogEntries = (await this.adapter.transaction<OplogEntry[]>(
        (tx, setResult) => {
          tx.query(q1, (tx, res) => {
            if (res.length > 0)
              tx.run(q2, (tx) =>
                tx.run(q3, (tx) =>
                  tx.run(q4, () => setResult(res as unknown as OplogEntry[]))
                )
              )
            else {
              setResult([])
            }
          })
        }
      )) as OplogEntry[]

      if (oplogEntries.length > 0) this._notifyChanges(oplogEntries, 'local')

      if (
        this.client.getOutboundReplicationStatus() === ReplicationStatus.ACTIVE
      ) {
        const enqueued = this.client.getLastSentLsn()
        const enqueuedLogPos = bytesToNumber(enqueued)

        // TODO: handle case where pending oplog is large
        await this._getEntries(enqueuedLogPos).then((missing) =>
          this._replicateSnapshotChanges(missing)
        )
      }
      return timestamp
    } catch (e: any) {
      Log.error(`error performing snapshot: ${e}`)
      throw e
    } finally {
      this.performingSnapshot = false
    }
  }

  _notifyChanges(results: OplogEntry[], origin: ChangeOrigin): void {
    const acc: ChangeAccumulator = {}

    // Would it be quicker to do this using a second SQL query that
    // returns results in `Change` format?!
    const reduceFn = (acc: ChangeAccumulator, entry: OplogEntry) => {
      const qt = new QualifiedTablename(entry.namespace, entry.tablename)
      const key = qt.toString()

      if (key in acc) {
        const change: Change = acc[key]

        if (change.rowids === undefined) {
          change.rowids = []
        }
        if (change.recordChanges === undefined) {
          change.recordChanges = []
        }

        change.rowids.push(entry.rowid)
        change.recordChanges.push({
          primaryKey: JSON.parse(entry.primaryKey),
          type: entry.optype,
        })
      } else {
        acc[key] = {
          qualifiedTablename: qt,
          rowids: [entry.rowid],
          recordChanges: [
            {
              primaryKey: JSON.parse(entry.primaryKey),
              type: entry.optype,
            },
          ],
        }
      }

      return acc
    }

    const changes = Object.values(results.reduce(reduceFn, acc))
    this.notifier.actuallyChanged(this.dbName, changes, origin)
  }

  async _replicateSnapshotChanges(results: OplogEntry[]): Promise<void> {
    if (
      this.client.getOutboundReplicationStatus() !== ReplicationStatus.ACTIVE
    ) {
      return
    }

    const transactions = toTransactions(results, this.relations)
    for (const txn of transactions) {
      this.client.enqueueTransaction(txn)
    }
  }

  // Apply a set of incoming transactions against pending local operations,
  // applying conflict resolution rules. Takes all changes per each key before
  // merging, for local and remote operations.

  // TODO: in case the subscriptions between the client and server become
  // out of sync, the server might send operations that do not belong to
  // any existing subscription. We need a way to detect and prevent that.
  async _apply(incoming: OplogEntry[], incoming_origin: string) {
    const local = await this._getEntries()
    const merged = mergeEntries(
      this._authState!.clientId,
      local,
      incoming_origin,
      incoming,
      this.relations
    )

    const stmts: Statement[] = []
    for (const [tablenameStr, mapping] of Object.entries(merged)) {
      const qualifiedTableName = QualifiedTablename.parse(tablenameStr)
      for (const entryChanges of Object.values(mapping)) {
        const shadowEntry: ShadowEntry = {
          namespace: entryChanges.namespace,
          tablename: entryChanges.tablename,
          primaryKey: getShadowPrimaryKey(entryChanges),
          tags: encodeTags(entryChanges.tags),
        }

        switch (entryChanges.optype) {
          case OPTYPES.gone:
          case OPTYPES.delete:
            stmts.push(
              this._applyDeleteOperation(entryChanges, qualifiedTableName)
            )
            stmts.push(this._deleteShadowTagsStatement(shadowEntry))
            break

          default:
            stmts.push(
              this._applyNonDeleteOperation(entryChanges, qualifiedTableName)
            )
            stmts.push(this._updateShadowTagsStatement(shadowEntry))
        }
      }
    }

    const tablenames = Object.keys(merged)
    return {
      tablenames,
      statements: stmts,
    }
  }

  async _getEntries(since?: number): Promise<OplogEntry[]> {
    // `rowid` is never below 0, so -1 means "everything"
    since ??= -1
    const oplog = `${this.opts.oplogTable}`

    const selectEntries = `
      SELECT * FROM ${oplog}
        WHERE timestamp IS NOT NULL
          AND rowid > ${this.builder.makePositionalParam(1)}
        ORDER BY rowid ASC
    `
    const rows = await this.adapter.query({ sql: selectEntries, args: [since] })
    return rows as unknown as OplogEntry[]
  }

  _deleteShadowTagsStatement(shadow: ShadowEntry): Statement {
    const shadowTable = `${this.opts.shadowTable}`
    const pos = (i: number) => this.builder.makePositionalParam(i)
    const deleteRow = `
      DELETE FROM ${shadowTable}
      WHERE namespace = ${pos(1)} AND
            tablename = ${pos(2)} AND
            "primaryKey" = ${pos(3)};
    `
    return {
      sql: deleteRow,
      args: [shadow.namespace, shadow.tablename, shadow.primaryKey],
    }
  }

  _updateShadowTagsStatement(shadow: ShadowEntry): Statement {
    return this.builder.insertOrReplace(
      this.opts.shadowTable,
      ['namespace', 'tablename', 'primaryKey', 'tags'],
      [shadow.namespace, shadow.tablename, shadow.primaryKey, shadow.tags],
      ['namespace', 'tablename', 'primaryKey'],
      ['tags']
    )
  }

  _updateRelations(rel: Omit<Relation, 'id'>) {
    if (rel.tableType === SatRelation_RelationType.TABLE) {
      // this relation may be for a newly created table
      // or for a column that was added to an existing table
      const tableName = rel.table

      if (this.relations[tableName] === undefined) {
        let id = 0
        // generate an id for the new relation as (the highest existing id) + 1
        // TODO: why not just use the relation.id coming from pg?
        for (const r of Object.values(this.relations)) {
          if (r.id > id) {
            id = r.id
          }
        }
        const relation = {
          ...rel,
          id: id + 1,
        }
        this.relations[tableName] = relation
      } else {
        // the relation is for an existing table
        // update the information but keep the same ID
        const id = this.relations[tableName].id
        const relation = {
          ...rel,
          id: id,
        }
        this.relations[tableName] = relation
      }
    }
  }

  async _applyTransaction(transaction: Transaction) {
    const namespace = this.builder.defaultNamespace
    const origin = transaction.origin!
    const commitTimestamp = new Date(transaction.commit_timestamp.toNumber())

    // Transactions coming from the replication stream
    // may contain DML operations manipulating data
    // but may also contain DDL operations migrating schemas.
    // DML operations are ran through conflict resolution logic.
    // DDL operations are applied as is against the local DB.

    // `stmts` will store all SQL statements
    // that need to be executed
    const stmts: Statement[] = []
    // `txStmts` will store the statements related to the transaction
    // including the creation of triggers
    // but not statements that disable/enable the triggers
    // neither statements that update meta tables or modify pragmas.
    // The `txStmts` is used to compute the hash of migration transactions
    const txStmts: Statement[] = []
    const tablenamesSet: Set<string> = new Set()
    let newTables: Set<string> = new Set()
    const opLogEntries: OplogEntry[] = []
    const lsn = transaction.lsn
    let firstDMLChunk = true

    // Defer (SQLite) or temporarily disable FK checks (Postgres)
    // because order of inserts may not respect referential integrity
    // and Postgres doesn't let us defer FKs
    // that were not originally defined as deferrable
    stmts.push({ sql: this.builder.deferOrDisableFKsForTx })

    // update lsn.
    stmts.push(this.updateLsnStmt(lsn))
    stmts.push(this._resetAllSeenStmt())

    const processDML = async (changes: DataChange[]) => {
      const tx = {
        ...transaction,
        changes,
      }
      const entries = fromTransaction(tx, this.relations, namespace)

      // Before applying DML statements we need to assign a timestamp to pending operations.
      // This only needs to be done once, even if there are several DML chunks
      // because all those chunks are part of the same transaction.
      if (firstDMLChunk) {
        Log.info(`apply incoming changes for LSN: ${base64.fromBytes(lsn)}`)
        // assign timestamp to pending operations before apply
        await this._mutexSnapshot()
        firstDMLChunk = false
      }

      const { statements, tablenames } = await this._apply(entries, origin)
      entries.forEach((e) => opLogEntries.push(e))
      statements.forEach((s) => stmts.push(s))
      tablenames.forEach((n) => tablenamesSet.add(n))
    }
    const processDDL = async (changes: SchemaChange[]) => {
      const createdTables: Set<string> = new Set()
      const affectedTables: Map<string, MigrationTable> = new Map()
      changes.forEach((change) => {
        const changeStmt = { sql: change.sql }
        stmts.push(changeStmt)

        if (
          change.migrationType === SatOpMigrate_Type.CREATE_TABLE ||
          change.migrationType === SatOpMigrate_Type.ALTER_ADD_COLUMN
        ) {
          // We will create/update triggers for this new/updated table
          // so store it in `tablenamesSet` such that those
          // triggers can be disabled while executing the transaction
          const affectedTable = new QualifiedTablename(
            namespace,
            change.table.name
          ).toString()
          // store the table information to generate the triggers after this `forEach`
          affectedTables.set(affectedTable, change.table)
          tablenamesSet.add(affectedTable)

          if (change.migrationType === SatOpMigrate_Type.CREATE_TABLE) {
            createdTables.add(affectedTable)
          }
        }
      })

      // Also add statements to create the necessary triggers for the created/updated table
      affectedTables.forEach((table) => {
        const triggers = generateTriggersForTable(table, this.builder)
        stmts.push(...triggers)
        txStmts.push(...triggers)
      })

      // Disable the newly created triggers
      // during the processing of this transaction
      const createdQualifiedTables = Array.from(createdTables).map(
        QualifiedTablename.parse
      )
      stmts.push(...this._disableTriggers(createdQualifiedTables))
      newTables = new Set([...newTables, ...createdTables])
    }

    // Start with garbage collection, because if this a transaction after round-trip, then we don't want it in conflict resolution
    await this.maybeGarbageCollect(origin, commitTimestamp)

    // Chunk incoming changes by their types, and process each chunk one by one
    for (const [dataChange, chunk] of chunkBy(
      transaction.changes,
      isDataChange
    )) {
      if (dataChange) {
        await processDML(chunk as DataChange[])
      } else {
        await processDDL(chunk as SchemaChange[])
      }
    }

    // Now run the DML and DDL statements in-order in a transaction
    const tablenames = Array.from(tablenamesSet)
    const qualifiedTables = tablenames.map(QualifiedTablename.parse)
    const notNewTableNames = tablenames.filter((t) => !newTables.has(t))
    const notNewQualifiedTables = notNewTableNames.map(QualifiedTablename.parse)

    const allStatements = this._disableTriggers(notNewQualifiedTables)
      .concat(stmts)
      .concat(this._enableTriggers(qualifiedTables))

    if (transaction.migrationVersion) {
      // If a migration version is specified
      // then the transaction is a migration
      await this.migrator.applyIfNotAlready({
        statements: allStatements,
        version: transaction.migrationVersion,
      })
    } else {
      await this.adapter.runInTransaction(...allStatements)
    }

    this._notifyChanges(opLogEntries, 'remote')
  }

  async _applyAdditionalData(data: AdditionalData) {
    // Server sends additional data on move-ins and tries to send only data
    // the client has never seen from its perspective. Because of this, we're writing this
    // data directly, like subscription data
    return this._applySubscriptionData(data.changes, this._lsn!, [
      this._addSeenAdditionalDataStmt(data.ref.toString()),
    ])
  }

  async _applyGoneBatch(
    lsn: LSN,
    subscriptionIds: string[],
    allGone: DataGone[]
  ) {
    const fakeOplogEntries: OplogEntry[] = allGone.map(
      (x): OplogEntry => ({
        namespace: this.builder.defaultNamespace,
        tablename: x.relation.table,
        primaryKey: extractPK(x),
        optype: 'GONE',
        // Fields below don't matter here.
        rowid: -1,
        timestamp: '',
        clearTags: '',
      })
    )

    // Batch-delete shadow entries
    const stmts = this.builder.prepareDeleteBatchedStatements(
      `DELETE FROM ${this.opts.shadowTable} WHERE `,
      ['namespace', 'tablename', 'primaryKey'],
      fakeOplogEntries,
      this.maxSqlParameters
    )

    const groupedChanges = groupBy(allGone, (x) => x.relation.table)
    const affectedTables = Object.keys(groupedChanges).map((x) =>
      this.builder.makeQT(x)
    )

    // Batch-delete affected rows per table
    for (const [table, gone] of Object.entries(groupedChanges)) {
      if (gone.length === 0) continue

      const fqtn = this.builder.makeQT(table)
      const pkCols = gone[0].relation.columns
        .filter((x) => x.primaryKey)
        .map((x) => x.name)

      stmts.push(
        ...this.builder.prepareDeleteBatchedStatements(
          `DELETE FROM ${fqtn} WHERE`,
          pkCols,
          gone.map((x) => x.oldRecord) as Record<string, SqlValue>[],
          this.maxSqlParameters
        )
      )
    }

    await this.adapter.runInTransaction(
      this.updateLsnStmt(lsn),
      { sql: this.builder.deferOrDisableFKsForTx },
      ...this._disableTriggers(affectedTables),
      ...stmts,
      ...this._enableTriggers(affectedTables)
    )

    this.subscriptionManager.goneBatchDelivered(subscriptionIds)

    this._notifyChanges(fakeOplogEntries, 'remote')
  }

  private async maybeGarbageCollect(
    origin: string,
    commitTimestamp: Date
  ): Promise<void> {
    if (origin === this._authState!.clientId) {
      /* Any outstanding transaction that originated on Satellite but haven't
       * been received back from the Electric is considered to be concurrent with
       * any other transaction coming from Electric.
       *
       * Thus we need to keep oplog entries in order to be able to do conflict
       * resolution with add-wins semantics.
       *
       * Once we receive transaction that was originated on the Satellite, oplog
       * entries that correspond to such transaction can be safely removed as
       * they are no longer necessary for conflict resolution.
       */
      await this._garbageCollectOplog(commitTimestamp)
    }
  }

  _disableTriggers(tables: QualifiedTablename[]): Statement[] {
    return this._updateTriggerSettings(tables, 0)
  }

  _enableTriggers(tables: QualifiedTablename[]): Statement[] {
    return this._updateTriggerSettings(tables, 1)
  }

  _updateTriggerSettings(
    tables: QualifiedTablename[],
    flag: 0 | 1
  ): Statement[] {
    if (tables.length === 0) return []
    const triggers = `${this.opts.triggersTable}`
    const namespacesAndTableNames = tables.flatMap((tbl) => [
      tbl.namespace,
      tbl.tablename,
    ])
    const pos = (i: number) => this.builder.makePositionalParam(i)
    let i = 1
    return [
      {
        sql: `UPDATE ${triggers} SET flag = ${pos(i++)} WHERE ${tables
          .map((_) => `(namespace = ${pos(i++)} AND tablename = ${pos(i++)})`)
          .join(' OR ')}`,
        args: [flag, ...namespacesAndTableNames],
      },
    ]
  }

  _addSeenGoneBatchStmt(subscriptionIds: string[]): Statement {
    const meta = `${this.opts.metaTable}`

    return {
      sql: `INSERT INTO ${meta} VALUES ('seenGoneBatch', ${this.builder.makePositionalParam(
        1
      )} ON CONFLICT (key) DO UPDATE SET value = ${meta}.value || ',' || excluded.value`,
      args: [subscriptionIds.join(',')],
    }
  }

  _addSeenAdditionalDataStmt(ref: string): Statement {
    const meta = `${this.opts.metaTable}`
    const sql = `
      INSERT INTO ${meta} (key, value) VALUES ('seenAdditionalData', ${this.builder.makePositionalParam(
      1
    )})
        ON CONFLICT (key) DO
          UPDATE SET value = ${meta}.value || ',' || excluded.value
    `
    const args = [ref]
    return { sql, args }
  }

  _resetAllSeenStmt(
    keys: (keyof MetaEntries)[] = ['seenAdditionalData', 'seenGoneBatch']
  ): Statement {
    const whereClause = keys
      .map((_, i) => `key = ${this.builder.makePositionalParam(i + 1)}`)
      .join(' OR ')
    const sql = `UPDATE ${this.opts.metaTable} SET VALUE = '' WHERE ${whereClause}`

    return { sql, args: keys }
  }

  _setMetaStatement<K extends keyof MetaEntries>(
    key: K,
    value: MetaEntries[K]
  ): Statement
  _setMetaStatement(key: Uuid, value: string | null): Statement
  _setMetaStatement(key: string, value: SqlValue) {
    const meta = `${this.opts.metaTable}`
    const pos = (i: number) => this.builder.makePositionalParam(i)
    const sql = `UPDATE ${meta} SET value = ${pos(1)} WHERE key = ${pos(2)}`
    const args = [value, key]
    return { sql, args }
  }

  async _setMeta<K extends keyof MetaEntries>(
    key: K,
    value: MetaEntries[K]
  ): Promise<void>
  async _setMeta(key: Uuid, value: string | null): Promise<void>
  async _setMeta(
    key: Parameters<this['_setMetaStatement']>[0],
    value: Parameters<this['_setMetaStatement']>[1]
  ) {
    const stmt = this._setMetaStatement(key, value)
    await this.adapter.run(stmt)
  }

  async _getMeta(key: Uuid): Promise<string | null>
  async _getMeta<K extends keyof MetaEntries>(key: K): Promise<MetaEntries[K]>
  async _getMeta(key: string) {
    const meta = `${this.opts.metaTable}`
    const pos = (i: number) => this.builder.makePositionalParam(i)
    const sql = `SELECT value from ${meta} WHERE key = ${pos(1)}`
    const args = [key]
    const rows = await this.adapter.query({ sql, args })

    if (rows.length !== 1) {
      throw `Invalid metadata table: missing ${key}`
    }

    return rows[0].value
  }

  private async _getClientId(): Promise<Uuid> {
    const clientIdKey = 'clientId'

    let clientId = await this._getMeta(clientIdKey)

    if (clientId === '') {
      clientId = genUUID()
      await this._setMeta(clientIdKey, clientId)
    }
    return clientId
  }

  private async _getLocalRelations(): Promise<{ [k: string]: Relation }> {
    return inferRelationsFromDb(this.adapter, this.opts, this.builder)
  }

  private _generateTag(timestamp: Date): string {
    const instanceId = this._authState!.clientId
    return generateTag(instanceId, timestamp)
  }

  async _garbageCollectOplog(commitTimestamp: Date): Promise<void> {
    const isoString = commitTimestamp.toISOString()
    const oplog = `${this.opts.oplogTable}`
    const pos = (i: number) => this.builder.makePositionalParam(i)
    await this.adapter.run({
      sql: `DELETE FROM ${oplog} WHERE timestamp = ${pos(1)}`,
      args: [isoString],
    })
  }

  /**
   * Update `this._lsn` to the new value and generate a statement to persist this change
   *
   * @param lsn new LSN value
   * @returns statement to be executed to save the new LSN value in the database
   */
  private updateLsnStmt(lsn: LSN): Statement {
    this._lsn = lsn
    return this._setMetaStatement('lsn', base64.fromBytes(lsn))
  }

  public setReplicationTransform(
    tableName: QualifiedTablename,
    transform: ReplicatedRowTransformer<DataRecord>
  ): void {
    this.client.setReplicationTransform(tableName, transform)
  }

  public clearReplicationTransform(tableName: QualifiedTablename): void {
    this.client.clearReplicationTransform(tableName)
  }

  _applyDeleteOperation(
    entryChanges: ShadowEntryChanges,
    qualifiedTableName: QualifiedTablename
  ): Statement {
    const pkEntries = Object.entries(entryChanges.primaryKeyCols)
    if (pkEntries.length === 0)
      throw new Error(
        "Can't apply delete operation. None of the columns in changes are marked as PK."
      )
    let i = 1
    const pos = (i: number) => this.builder.makePositionalParam(i)
    const params = pkEntries.reduce(
      (acc, [column, value]) => {
        acc.where.push(`${column} = ${pos(i++)}`)
        acc.values.push(value)
        return acc
      },
      { where: [] as string[], values: [] as SqlValue[] }
    )

    return {
      sql: `DELETE FROM "${qualifiedTableName.namespace}"."${
        qualifiedTableName.tablename
      }" WHERE ${params.where.join(' AND ')}`,
      args: params.values,
    }
  }

  _applyNonDeleteOperation(
    { fullRow, primaryKeyCols }: ShadowEntryChanges,
    qualifiedTableName: QualifiedTablename
  ): Statement {
    const columnNames = Object.keys(fullRow)
    const columnValues = Object.values(fullRow)
    const updateColumnStmts = columnNames.filter((c) => !(c in primaryKeyCols))

    if (updateColumnStmts.length > 0) {
      return this.builder.insertOrReplaceWith(
        qualifiedTableName,
        columnNames,
        columnValues,
        Object.keys(primaryKeyCols),
        updateColumnStmts,
        updateColumnStmts.map((col) => fullRow[col])
      )
    }

    // no changes, can ignore statement if exists
    return this.builder.insertOrIgnore(
      qualifiedTableName,
      columnNames,
      columnValues
    )
  }

  private async checkMaxSqlParameters() {
    if (this.builder.dialect === 'SQLite') {
      const [{ version }] = (await this.adapter.query({
        sql: 'SELECT sqlite_version() AS version',
      })) as [{ version: string }]

      const [major, minor, _patch] = version.split('.').map((x) => parseInt(x))

      if (major === 3 && minor >= 32) this.maxSqlParameters = 32766
      else this.maxSqlParameters = 999
    } else {
      // Postgres allows a maximum of 65535 query parameters
      this.maxSqlParameters = 65535
    }
  }
}

export function generateTriggersForTable(
  tbl: MigrationTable,
  builder: QueryBuilder
): Statement[] {
  const table = {
    qualifiedTableName: new QualifiedTablename(
      builder.defaultNamespace,
      tbl.name
    ),
    columns: tbl.columns.map((col) => col.name),
    primary: tbl.pks,
    foreignKeys: tbl.fks.map((fk) => {
      if (fk.fkCols.length !== 1 || fk.pkCols.length !== 1)
        throw new Error('Satellite does not yet support compound foreign keys.')
      return {
        table: fk.pkTable,
        childKey: fk.fkCols[0],
        parentKey: fk.pkCols[0],
      }
    }),
    columnTypes: Object.fromEntries(
      tbl.columns.map((col) => [col.name, col.pgType!.name.toUpperCase()])
    ),
  }

  return generateTableTriggers(table, builder)
}
