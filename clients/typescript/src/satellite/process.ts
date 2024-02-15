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
  ConnectivityStateChangeNotification,
  Notifier,
  UnsubscribeFunction,
} from '../notifiers/index'
import {
  Waiter,
  base64,
  bytesToNumber,
  emptyPromise,
  getWaiter,
  uuid,
} from '../util/common'
import { QualifiedTablename } from '../util/tablename'
import {
  ConnectivityState,
  DataChange,
  DbName,
  LSN,
  MigrationTable,
  Relation,
  RelationsCache,
  SatelliteError,
  SatelliteErrorCode,
  SchemaChange,
  SqlValue,
  Statement,
  Transaction,
  isDataChange,
} from '../util/types'
import { SatelliteOpts } from './config'
import { Client, ConnectionWrapper, Satellite } from './index'
import {
  OPTYPES,
  OplogEntry,
  ShadowEntry,
  ShadowEntryChanges,
  encodeTags,
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
import { SubscriptionsManager } from './shapes'
import { InMemorySubscriptionsManager } from './shapes/manager'
import {
  ClientShapeDefinition,
  InitialDataChange,
  ShapeDefinition,
  ShapeRequest,
  ShapeSelect,
  SubscribeResponse,
  SubscriptionData,
} from './shapes/types'
import { backOff } from 'exponential-backoff'
import { chunkBy } from '../util'
import { isFatal, isOutOfSyncError, isThrowable, wrapFatalError } from './error'
import { inferRelationsFromDb } from '../util/relations'
import { QueryBuilder } from '../migrators/query-builder'

type ChangeAccumulator = {
  [key: string]: Change
}

export type ShapeSubscription = {
  synced: Promise<void>
}

type ThrottleFunction = {
  cancel: () => void
  (): Promise<Date> | undefined
}

type Uuid = `${string}-${string}-${string}-${string}-${string}`

type MetaEntries = {
  clientId: Uuid | ''
  compensations: number
  lsn: string | null
  subscriptions: string
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

  previousShapeSubscriptions: ClientShapeDefinition[]
  subscriptions: SubscriptionsManager
  subscriptionNotifiers: Record<string, ReturnType<typeof emptyPromise<void>>>
  subscriptionIdGenerator: (...args: any) => string
  shapeRequestIdGenerator: (...args: any) => string

  /**
   * To optimize inserting a lot of data when the subscription data comes, we need to do
   * less `INSERT` queries, but SQLite supports only a limited amount of `?` positional
   * arguments. Precisely, its either 999 for versions prior to 3.32.0 and 32766 for
   * versions after.
   */
  private maxSqlParameters: 999 | 32766 | 65535 = 999
  private snapshotMutex: Mutex = new Mutex()
  private performingSnapshot = false

  private _connectRetryHandler: ConnectRetryHandler
  private initializing?: Waiter

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
    this.builder = this.migrator.electricQueryBuilder

    this.opts = opts
    this.relations = {}

    this.previousShapeSubscriptions = []
    this.subscriptions = new InMemorySubscriptionsManager(
      this._garbageCollectShapeHandler.bind(this)
    )
    this._throttledSnapshot = throttle(
      this.mutexSnapshot.bind(this),
      opts.minSnapshotWindow,
      {
        leading: true,
        trailing: true,
      }
    )
    this.subscriptionNotifiers = {}

    this.subscriptionIdGenerator = () => uuid()
    this.shapeRequestIdGenerator = this.subscriptionIdGenerator

    this._connectRetryHandler = connectRetryHandler

    this.setClientListeners()
  }

  /**
   * Perform a snapshot while taking out a mutex to avoid concurrent calls.
   */
  private async mutexSnapshot() {
    const release = await this.snapshotMutex.acquire()
    try {
      return await this._performSnapshot()
    } finally {
      release()
    }
  }

  async start(authConfig: AuthConfig): Promise<ConnectionWrapper> {
    if (this.opts.debug) {
      await this.logDatabaseVersion()
    }

    await this.migrator.up()

    const isVerified = await this._verifyTableStructure()
    if (!isVerified) {
      throw new Error('Invalid database schema.')
    }

    const clientId =
      authConfig.clientId && authConfig.clientId !== ''
        ? authConfig.clientId
        : await this._getClientId()
    await this._setAuthState({ clientId: clientId, token: authConfig.token })

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

    // Monitor connectivity state changes.
    const connectivityStateHandler = ({
      connectivityState,
    }: ConnectivityStateChangeNotification) => {
      this._handleConnectivityStateChange(connectivityState)
    }
    this._unsubscribeFromConnectivityChanges =
      this.notifier.subscribeToConnectivityStateChanges(
        connectivityStateHandler
      )

    // Request a snapshot whenever the data in our database potentially changes.
    this._unsubscribeFromPotentialDataChanges =
      this.notifier.subscribeToPotentialDataChanges(this._throttledSnapshot)

    // Start polling to request a snapshot every `pollingInterval` ms.
    this._pollingInterval = setInterval(
      this._throttledSnapshot,
      this.opts.pollingInterval
    )

    // Starting now!
    setTimeout(this._throttledSnapshot, 0)

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
      this.subscriptions.setState(subscriptionsState)
    }

    const connectionPromise = this._connectWithBackoff()
    return { connectionPromise }
  }

  private async logDatabaseVersion(): Promise<void> {
    const versionRow = await this.adapter.query({
      sql: this.builder.getVersion,
    })
    Log.info(
      `Using ${this.builder.dialect} version: ${versionRow[0]['version']}`
    )
  }

  async _setAuthState(authState: AuthState): Promise<void> {
    this._authState = authState
  }

  async _garbageCollectShapeHandler(
    shapeDefs: ShapeDefinition[]
  ): Promise<void> {
    const stmts: Statement[] = []
    const tables: QualifiedTablename[] = []
    // reverts to off on commit/abort
    stmts.push({ sql: this.builder.deferForeignKeys })
    shapeDefs
      .flatMap((def: ShapeDefinition) => def.definition.selects)
      .map((select: ShapeSelect) => {
        const qualifiedTable = new QualifiedTablename('main', select.tablename)
        tables.push(qualifiedTable)
        return qualifiedTable
      }) // We need "fully qualified" table names in the next calls
      .reduce((stmts: Statement[], table: QualifiedTablename) => {
        stmts.push({
          sql: `DELETE FROM "${table.namespace}"."${table.tablename}"`,
        })
        return stmts
        // does not delete shadow rows but we can do that
      }, stmts)

    const stmtsWithTriggers = [
      ...this._disableTriggers(tables),
      ...stmts,
      ...this._enableTriggers(tables),
    ]

    await this.adapter.runInTransaction(...stmtsWithTriggers)
  }

  setClientListeners(): void {
    this.client.subscribeToError(this._handleClientError.bind(this))
    this.client.subscribeToRelations(this._updateRelations.bind(this))
    this.client.subscribeToTransactions(this._applyTransaction.bind(this))
    this.client.subscribeToOutboundStarted(this._throttledSnapshot.bind(this))

    this.client.subscribeToSubscriptionEvents(
      this._handleSubscriptionData.bind(this),
      this._handleSubscriptionError.bind(this)
    )
  }

  // Unsubscribe from data changes and stop polling
  async stop(shutdown?: boolean): Promise<void> {
    // Stop snapshotting and polling for changes.
    this._throttledSnapshot.cancel()

    if (this._pollingInterval !== undefined) {
      clearInterval(this._pollingInterval)

      this._pollingInterval = undefined
    }

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

    this._disconnect()

    if (shutdown) {
      this.client.shutdown()
    }
  }

  async subscribe(
    shapeDefinitions: ClientShapeDefinition[]
  ): Promise<ShapeSubscription> {
    // Await for client to be ready before doing anything else
    await this.initializing?.waitOn()

    // First, we want to check if we already have either fulfilled or fulfilling subscriptions with exactly the same definitions
    const existingSubscription =
      this.subscriptions.getDuplicatingSubscription(shapeDefinitions)
    if (existingSubscription !== null && 'inFlight' in existingSubscription) {
      return {
        synced:
          this.subscriptionNotifiers[existingSubscription.inFlight].promise,
      }
    } else if (
      existingSubscription !== null &&
      'fulfilled' in existingSubscription
    ) {
      return { synced: Promise.resolve() }
    }

    // If no exact match found, we try to establish the subscription
    const shapeReqs: ShapeRequest[] = shapeDefinitions.map((definition) => ({
      requestId: this.shapeRequestIdGenerator(),
      definition,
    }))

    const subId = this.subscriptionIdGenerator()
    this.subscriptions.subscriptionRequested(subId, shapeReqs)

    // store the resolve and reject
    // such that we can resolve/reject
    // the promise later when the shape
    // is fulfilled or when an error arrives
    // we store it before making the actual request
    // to avoid that the answer would arrive too fast
    // and this resolver and rejecter would not yet be stored
    // this could especially happen in unit tests
    this.subscriptionNotifiers[subId] = emptyPromise()
    // store the promise because by the time the
    // `await this.client.subscribe(subId, shapeReqs)` call resolves
    // the `subId` entry in the `subscriptionNotifiers` may have been deleted
    // so we can no longer access it
    const subProm = this.subscriptionNotifiers[subId].promise

    // `clearSubAndThrow` deletes the listeners and cancels the subscription
    const clearSubAndThrow = (error: any): never => {
      delete this.subscriptionNotifiers[subId]
      this.subscriptions.subscriptionCancelled(subId)
      throw error
    }

    try {
      const { subscriptionId, error }: SubscribeResponse =
        await this.client.subscribe(subId, shapeReqs)
      if (subId !== subscriptionId) {
        clearSubAndThrow(
          new Error(
            `Expected SubscripeResponse for subscription id: ${subId} but got it for another id: ${subscriptionId}`
          )
        )
      }

      if (error) {
        clearSubAndThrow(error)
      }

      return {
        synced: subProm,
      }
    } catch (error: any) {
      return clearSubAndThrow(error)
    }
  }

  async unsubscribe(_subscriptionId: string): Promise<void> {
    throw new SatelliteError(
      SatelliteErrorCode.INTERNAL,
      'unsubscribe shape not supported'
    )
    // return this.subscriptions.unsubscribe(subscriptionId)
  }

  async _handleSubscriptionData(subsData: SubscriptionData): Promise<void> {
    this.subscriptions.subscriptionDelivered(subsData)

    // When data is empty, we will simply store the subscription and lsn state
    // Not storing this state means that a second open of the app will try to
    // re-insert rows which will possible trigger a UNIQUE constraint violation
    await this._applySubscriptionData(subsData.data, subsData.lsn)

    // Call the `onSuccess` callback for this subscription
    const { resolve: onSuccess } =
      this.subscriptionNotifiers[subsData.subscriptionId]
    delete this.subscriptionNotifiers[subsData.subscriptionId] // GC the notifiers for this subscription ID
    onSuccess()
  }

  // Applies initial data for a shape subscription. Current implementation
  // assumes there are no conflicts INSERTing new rows and only expects
  // subscriptions for entire tables.
  async _applySubscriptionData(changes: InitialDataChange[], lsn: LSN) {
    const stmts: Statement[] = []
    stmts.push({ sql: this.builder.deferForeignKeys })

    // It's much faster[1] to do less statements to insert the data instead of doing an insert statement for each row
    // so we're going to do just that, but with a caveat: SQLite has a max number of parameters in prepared statements,
    // so this is less of "insert all at once" and more of "insert in batches". This should be even more noticeable with
    // WASM builds, since we'll be crossing the JS-WASM boundary less.
    //
    // [1]: https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2

    const groupedChanges = new Map<
      string,
      {
        columns: string[]
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
      const tableName = new QualifiedTablename('main', op.relation.table)
      if (groupedChanges.has(tableName.toString())) {
        groupedChanges.get(tableName.toString())?.records.push(op.record)
      } else {
        groupedChanges.set(tableName.toString(), {
          columns: op.relation.columns.map((x) => x.name),
          records: [op.record],
          table: tableName,
        })
      }

      // Since we're already iterating changes, we can also prepare data for shadow table
      const primaryKeyCols = op.relation.columns.reduce((agg, col) => {
        if (col.primaryKey)
          agg[col.name] = op.record[col.name] as string | number
        return agg
      }, {} as Record<string, string | number>)

      allArgsForShadowInsert.push({
        namespace: 'main',
        tablename: op.relation.table,
        primaryKey: primaryKeyToStr(primaryKeyCols),
        tags: encodeTags(op.tags),
      })
    }

    const qualifiedTableNames = [
      ...Array.from(groupedChanges.values()).map((chg) => chg.table),
    ]

    console.log(`Apply subs data: ${JSON.stringify(qualifiedTableNames)}`)

    // Disable trigger for all affected tables
    stmts.push(...this._disableTriggers(qualifiedTableNames))

    // For each table, do a batched insert
    for (const [_table, { columns, records, table }] of groupedChanges) {
      const qualifiedTableName = `"${table.namespace}"."${table.tablename}"`
      const sqlBase = `INSERT INTO ${qualifiedTableName} (${columns.join(
        ', '
      )}) VALUES `

      stmts.push(
        ...this.builder.prepareInsertBatchedStatements(
          sqlBase,
          columns,
          records as Record<string, SqlValue>[],
          this.maxSqlParameters
        )
      )
    }

    // And re-enable the triggers for all of them
    stmts.push(...this._enableTriggers(qualifiedTableNames))

    // Then do a batched insert for the shadow table
    const batchedShadowInserts = this.builder.batchedInsertOrReplace(
      this.opts.shadowTable.namespace,
      this.opts.shadowTable.tablename,
      ['namespace', 'tablename', 'primaryKey', 'tags'],
      allArgsForShadowInsert,
      ['namespace', 'tablename', 'primaryKey'],
      ['namespace', 'tablename', 'tags'],
      this.maxSqlParameters
    )
    stmts.push(...batchedShadowInserts)

    // Then update subscription state and LSN
    stmts.push(
      this._setMetaStatement('subscriptions', this.subscriptions.serialize()),
      this.updateLsnStmt(lsn)
    )

    try {
      await this.adapter.runInTransaction(...stmts)

      // We're explicitly not specifying rowids in these changes for now,
      // because nobody uses them and we don't have the machinery to to a
      // `RETURNING` clause in the middle of `runInTransaction`.
      const notificationChanges: Change[] = changes.map((x) => ({
        qualifiedTablename: new QualifiedTablename('main', x.relation.table),
        rowids: [],
      }))
      this.notifier.actuallyChanged(this.dbName, notificationChanges)
    } catch (e) {
      this._handleSubscriptionError(
        new SatelliteError(
          SatelliteErrorCode.INTERNAL,
          `Error applying subscription data: ${(e as any).message}`
        )
      )
    }
  }

  async _resetClientState(opts?: {
    keepSubscribedShapes: boolean
  }): Promise<void> {
    Log.warn(`resetting client state`)
    this._disconnect()
    const subscriptionIds = this.subscriptions.getFulfilledSubscriptions()

    if (opts?.keepSubscribedShapes) {
      const shapeDefs: ClientShapeDefinition[] = subscriptionIds
        .map((subId) => this.subscriptions.shapesForActiveSubscription(subId))
        .filter((s): s is ShapeDefinition[] => s !== undefined)
        .flatMap((s: ShapeDefinition[]) => s.map((i) => i.definition))

      this.previousShapeSubscriptions.push(...shapeDefs)
    }

    this._lsn = undefined

    // TODO: this is obviously too conservative
    // we should also work on updating subscriptions
    // atomically on unsubscribe()
    await this.subscriptions.unsubscribeAll()

    await this.adapter.runInTransaction(
      this._setMetaStatement('lsn', null),
      this._setMetaStatement('subscriptions', this.subscriptions.serialize())
    )
  }

  async _handleSubscriptionError(
    satelliteError: SatelliteError,
    subscriptionId?: string
  ): Promise<void> {
    Log.error('encountered a subscription error: ' + satelliteError.message)

    await this._resetClientState()

    // Call the `onFailure` callback for this subscription
    if (subscriptionId) {
      const { reject: onFailure } = this.subscriptionNotifiers[subscriptionId]
      delete this.subscriptionNotifiers[subscriptionId] // GC the notifiers for this subscription ID
      onFailure(satelliteError)
    }
  }

  // handles async client erros: can be a socket error or a server error message
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

  _handleOrThrowClientError(error: SatelliteError): Promise<void> {
    this._disconnect()

    if (isThrowable(error)) {
      throw error
    }
    if (isFatal(error)) {
      throw wrapFatalError(error)
    }

    Log.warn('Client disconnected with a non fatal error, reconnecting')
    return this._connectWithBackoff()
  }

  async _handleConnectivityStateChange(
    status: ConnectivityState
  ): Promise<void> {
    Log.debug(`Connectivity state changed: ${status}`)
    switch (status) {
      case 'available': {
        Log.warn(`checking network availability and reconnecting`)
        return this._connectWithBackoff()
      }
      case 'disconnected': {
        this.client.disconnect()
        return
      }
      case 'connected': {
        return
      }
      default: {
        throw new Error(`unexpected connectivity state: ${status}`)
      }
    }
  }

  async _connectWithBackoff(): Promise<void> {
    if (!this.initializing || this.initializing?.finished()) {
      this.initializing = getWaiter()
    }

    const opts = {
      ...this.opts.connectionBackOffOptions,
      retry: this._connectRetryHandler,
    }

    await backOff(async () => {
      await this._connect()
      await this._startReplication()
      this._subscribePreviousShapeRequests()

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
      this._disconnect()
      this.initializing?.reject(error)
      throw error
    })
  }

  _subscribePreviousShapeRequests(): void {
    try {
      if (this.previousShapeSubscriptions.length > 0) {
        Log.warn(`Subscribing previous shape definitions`)
        this.subscribe(
          this.previousShapeSubscriptions.splice(
            0,
            this.previousShapeSubscriptions.length
          )
        )
      }
    } catch (error: any) {
      const message = `Client was unable to subscribe previously subscribed shapes: ${error.message}`
      throw new SatelliteError(SatelliteErrorCode.INTERNAL, message)
    }
  }

  // NO DIRECT CALLS TO CONNECT
  private async _connect(): Promise<void> {
    Log.info(`connecting to electric server`)

    if (!this._authState) {
      throw new Error(`trying to connect before authentication`)
    }
    const authState = this._authState

    try {
      await this.client.connect()
      const authResp = await this.client.authenticate(authState)

      if (authResp.error) {
        throw authResp.error
      }
    } catch (error: any) {
      Log.debug(
        `server returned an error while establishing connection: ${error.message}`
      )
      throw error
    }
  }

  private _disconnect(): void {
    this.client.disconnect()
    this._notifyConnectivityState('disconnected')
  }

  async _startReplication(): Promise<void> {
    try {
      const schemaVersion = await this.migrator.querySchemaVersion()

      // Fetch the subscription IDs that were fulfilled
      // such that we can resume and inform Electric
      // about fulfilled subscriptions
      const subscriptionIds = this.subscriptions.getFulfilledSubscriptions()

      const { error } = await this.client.startReplication(
        this._lsn,
        schemaVersion,
        subscriptionIds.length > 0 ? subscriptionIds : undefined
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

  private _notifyConnectivityState(connectivityState: ConnectivityState): void {
    this.connectivityState = connectivityState
    this.notifier.connectivityStateChanged(this.dbName, this.connectivityState)
  }

  async _verifyTableStructure(): Promise<boolean> {
    const meta = this.opts.metaTable.tablename
    const oplog = this.opts.oplogTable.tablename
    const shadow = this.opts.shadowTable.tablename

    const [{ numTables }] = await this.adapter.query(
      this.builder.countTablesIn('numTables', [meta, oplog, shadow])
    )
    return numTables === 3
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
      const oplog = `"${this.opts.oplogTable.namespace}"."${this.opts.oplogTable.tablename}"`
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

      // For each first oplog entry per element, set `clearTags` array to previous tags from the shadow table
      const q2: Statement = {
        sql: this.builder.setClearTagsForTimestamp(
          this.opts.oplogTable,
          this.opts.shadowTable
        ),
        args: [timestamp.toISOString()],
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

      if (oplogEntries.length > 0) this._notifyChanges(oplogEntries)

      if (this.client.isConnected()) {
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

  async _notifyChanges(results: OplogEntry[]): Promise<void> {
    Log.info('notify changes')
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

        change.rowids.push(entry.rowid)
      } else {
        acc[key] = {
          qualifiedTablename: qt,
          rowids: [entry.rowid],
        }
      }

      return acc
    }

    const changes = Object.values(results.reduce(reduceFn, acc))
    this.notifier.actuallyChanged(this.dbName, changes)
  }

  async _replicateSnapshotChanges(results: OplogEntry[]): Promise<void> {
    // TODO: Don't try replicating when outbound is inactive
    if (!this.client.isConnected()) {
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
      for (const entryChanges of Object.values(mapping)) {
        const shadowEntry: ShadowEntry = {
          namespace: entryChanges.namespace,
          tablename: entryChanges.tablename,
          primaryKey: getShadowPrimaryKey(entryChanges),
          tags: encodeTags(entryChanges.tags),
        }

        const qualifiedTableName = QualifiedTablename.parse(tablenameStr)

        switch (entryChanges.optype) {
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
    const oplog = `"${this.opts.oplogTable.namespace}"."${this.opts.oplogTable.tablename}"`

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
    const shadowTable = `"${this.opts.shadowTable.namespace}"."${this.opts.shadowTable.tablename}"`
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
      this.opts.shadowTable.namespace,
      this.opts.shadowTable.tablename,
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

    // switches off on transaction commit/abort
    //stmts.push({ sql: this.builder.deferForeignKeys })
    // update lsn.
    stmts.push(this.updateLsnStmt(lsn))

    const processDML = async (changes: DataChange[]) => {
      const tx = {
        ...transaction,
        changes: changes,
      }
      const entries = fromTransaction(tx, this.relations)

      // Before applying DML statements we need to assign a timestamp to pending operations.
      // This only needs to be done once, even if there are several DML chunks
      // because all those chunks are part of the same transaction.
      if (firstDMLChunk) {
        Log.info(`apply incoming changes for LSN: ${base64.fromBytes(lsn)}`)
        // assign timestamp to pending operations before apply
        await this.mutexSnapshot()
        firstDMLChunk = false
      }

      const { statements, tablenames } = await this._apply(entries, origin)
      entries.forEach((e) => opLogEntries.push(e))
      statements.forEach((s) => {
        stmts.push(s)
      })
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
            'main',
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
      console.log(`createdTablenames IN TRANSACTION: ${createdTables}`)
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
    console.log(`tablenames IN TRANSACTION: ${tablenames}`)
    const qualifiedTables = tablenames.map(QualifiedTablename.parse)
    const notNewTableNames = tablenames.filter((t) => !newTables.has(t))
    console.log(`notNewTablenames IN TRANSACTION: ${notNewTableNames}`)
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

    await this._notifyChanges(opLogEntries)
  }

  private async maybeGarbageCollect(
    origin: string,
    commitTimestamp: Date
  ): Promise<void> {
    if (origin == this._authState!.clientId) {
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
    const triggers = `"${this.opts.triggersTable.namespace}"."${this.opts.triggersTable.tablename}"`
    const namespacesAndTableNames = tables
      .map((tbl) => [tbl.namespace, tbl.tablename])
      .flat()
    if (tables.length > 0) {
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
    } else return []
  }

  _setMetaStatement<K extends keyof MetaEntries>(
    key: K,
    value: MetaEntries[K]
  ): Statement
  _setMetaStatement(key: Uuid, value: string | null): Statement
  _setMetaStatement(key: string, value: SqlValue) {
    const meta = `"${this.opts.metaTable.namespace}"."${this.opts.metaTable.tablename}"`
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
    const meta = `"${this.opts.metaTable.namespace}"."${this.opts.metaTable.tablename}"`
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
      clientId = uuid() as Uuid
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
    const oplog = `"${this.opts.oplogTable.namespace}"."${this.opts.oplogTable.tablename}"`
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
    const lsn_base64 = base64.fromBytes(lsn)
    const metatable = `"${this.opts.metaTable.namespace}"."${this.opts.metaTable.tablename}"`
    const pos = (i: number) => this.builder.makePositionalParam(i)
    return {
      sql: `UPDATE ${metatable} set value = ${pos(1)} WHERE key = ${pos(2)}`,
      args: [lsn_base64, 'lsn'],
    }
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
        qualifiedTableName.namespace,
        qualifiedTableName.tablename,
        columnNames,
        columnValues,
        ['id'],
        updateColumnStmts,
        updateColumnStmts.map((col) => fullRow[col])
      )
    }

    // no changes, can ignore statement if exists
    return this.builder.insertOrIgnore(
      qualifiedTableName.namespace,
      qualifiedTableName.tablename,
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
    tableName: tbl.name,
    namespace: 'main',
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
      tbl.columns.map((col) => [
        col.name,
        {
          sqliteType: col.sqliteType.toUpperCase(),
          pgType: col.pgType!.name.toUpperCase(),
        },
      ])
    ),
  }

  return generateTableTriggers(table, builder)
}
