import throttle from 'lodash.throttle'

import { AuthConfig, AuthState } from '../auth/index'
import { DatabaseAdapter, RunResult } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import {
  AuthStateNotification,
  Change,
  ConnectivityStateChangeNotification,
  Notifier,
} from '../notifiers/index'
import {
  Client,
  ConnectionWrapper,
  Satellite,
  SatelliteReplicationOptions,
} from './index'
import { QualifiedTablename } from '../util/tablename'
import {
  AckType,
  Change as Chg,
  ConnectivityState,
  DataChange,
  DbName,
  isDataChange,
  LSN,
  Relation,
  RelationsCache,
  SatelliteError,
  SchemaChange,
  Statement,
  Transaction,
  Row,
  MigrationTable,
  SatelliteErrorCode,
  SqlValue,
} from '../util/types'
import { SatelliteOpts } from './config'
import { mergeChangesLastWriteWins, mergeOpTags } from './merge'
import { difference } from '../util/sets'
import {
  decodeTags,
  encodeTags,
  fromTransaction,
  generateTag,
  getShadowPrimaryKey,
  localOperationsToTableChanges,
  newShadowEntry,
  OplogEntry,
  OPTYPES,
  primaryKeyToStr,
  remoteOperationsToTableChanges,
  ShadowEntry,
  ShadowEntryChanges,
  ShadowTableChanges,
  shadowTagsDefault,
  toTransactions,
} from './oplog'
import {
  SatOpMigrate_Type,
  SatRelation_RelationType,
} from '../_generated/protocol/satellite'
import {
  base64,
  bytesToNumber,
  emptyPromise,
  numberToBytes,
  uuid,
} from '../util/common'

import Log from 'loglevel'
import { generateOplogTriggers } from '../migrators/triggers'
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
import { SubscriptionsManager } from './shapes'
import { prepareBatchedStatements } from '../util/statements'

type ChangeAccumulator = {
  [key: string]: Change
}

export type ShapeSubscription = {
  synced: Promise<void>
}

const throwErrors = [
  SatelliteErrorCode.INVALID_POSITION,
  SatelliteErrorCode.BEHIND_WINDOW,
]

export class SatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  client: Client

  opts: SatelliteOpts

  _authState?: AuthState
  _authStateSubscription?: string

  _pollingInterval?: any
  _potentialDataChangeSubscription?: string
  _connectivityChangeSubscription?: string
  _throttledSnapshot?: {
    cancel: () => void
    (): void
  }

  _lastAckdRowId: number
  _lastSentRowId: number
  _lsn?: LSN

  relations: RelationsCache

  subscriptions: SubscriptionsManager
  subscriptionNotifiers: Record<string, ReturnType<typeof emptyPromise<void>>>
  subscriptionIdGenerator: (...args: any) => string
  shapeRequestIdGenerator: (...args: any) => string

  /*
  To optimize inserting a lot of data when the subscription data comes, we need to do
  less `INSERT` queries, but SQLite supports only a limited amount of `?` positional
  arguments. Precisely, its either 999 for versions prior to 3.32.0 and 32766 for
  versions after.
  */
  private maxSqlParameters: 999 | 32766 = 999

  constructor(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    client: Client,
    opts: SatelliteOpts,
  ) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.client = client

    this.opts = opts

    this._lastAckdRowId = 0
    this._lastSentRowId = 0

    this.relations = {}

    this.subscriptions = new InMemorySubscriptionsManager(
      this._garbageCollectShapeHandler.bind(this),
    )
    this.subscriptionNotifiers = {}

    this.subscriptionIdGenerator = () => uuid()
    this.shapeRequestIdGenerator = this.subscriptionIdGenerator
  }

  // Create a throttled function that performs a snapshot at most every
  // `minSnapshotWindow` ms. This function runs immediately when you
  // first call it and then every `minSnapshotWindow` ms as long as
  // you keep calling it within the window. If you don't call it within
  // the window, it will then run immediately the next time you call it.
  _throttleSnapshot = () => {
    const snapshot = this._performSnapshot.bind(this)
    const snapshotWindow = this.opts.minSnapshotWindow

    const throttleOpts = {
      leading: true,
      trailing: true,
    }

    return throttle(snapshot, snapshotWindow, throttleOpts)
  }

  async start(
    authConfig: AuthConfig,
    opts?: SatelliteReplicationOptions,
  ): Promise<ConnectionWrapper> {
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

    const subscriptions = Object.entries({
      _authStateSubscription: this._authStateSubscription,
      _connectivityChangeSubscription: this._connectivityChangeSubscription,
      _potentialDataChangeSubscription: this._potentialDataChangeSubscription,
    })
    subscriptions.forEach(([name, value]) => {
      if (value !== undefined) {
        throw new Error(
          `Starting satellite process with an existing
           \`${name}\`.
           This means there is a subscription leak.`,
        )
      }
    })

    // Monitor auth state changes.
    const authStateHandler = this._updateAuthState.bind(this)
    this._authStateSubscription =
      this.notifier.subscribeToAuthStateChanges(authStateHandler)

    // Monitor connectivity state changes.
    const connectivityStateHandler = ({
      connectivityState,
    }: ConnectivityStateChangeNotification) => {
      this._connectivityStateChanged(connectivityState)
    }
    this._connectivityChangeSubscription =
      this.notifier.subscribeToConnectivityStateChanges(
        connectivityStateHandler,
      )

    // Request a snapshot whenever the data in our database potentially changes.
    this._throttledSnapshot = this._throttleSnapshot()
    this._potentialDataChangeSubscription =
      this.notifier.subscribeToPotentialDataChanges(this._throttledSnapshot)

    // Start polling to request a snapshot every `pollingInterval` ms.
    this._pollingInterval = setInterval(
      this._throttledSnapshot,
      this.opts.pollingInterval,
    )

    // Starting now!
    setTimeout(this._throttledSnapshot, 0)

    // Need to reload primary keys after schema migration
    this.relations = await this._getLocalRelations()
    this.checkMaxSqlParameters()

    this._lastAckdRowId = Number(await this._getMeta('lastAckdRowId'))
    this._lastSentRowId = Number(await this._getMeta('lastSentRowId'))

    this.setClientListeners()
    this.client.resetOutboundLogPositions(
      numberToBytes(this._lastAckdRowId),
      numberToBytes(this._lastSentRowId),
    )

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

    const connectionPromise = this._connectAndStartReplication(opts)
    return { connectionPromise }
  }

  async _setAuthState(authState: AuthState): Promise<void> {
    this._authState = authState
  }

  async _garbageCollectShapeHandler(
    shapeDefs: ShapeDefinition[],
  ): Promise<void> {
    const stmts: Statement[] = []
    // reverts to off on commit/abort
    stmts.push({ sql: 'PRAGMA defer_foreign_keys = ON' })
    shapeDefs
      .flatMap((def: ShapeDefinition) => def.definition.selects)
      .map((select: ShapeSelect) => 'main.' + select.tablename) // We need "fully qualified" table names in the next calls
      .reduce((stmts: Statement[], tablename: string) => {
        stmts.push(
          ...this._disableTriggers([tablename]),
          {
            sql: `DELETE FROM ${tablename}`,
          },
          ...this._enableTriggers([tablename]),
        )
        return stmts
        // does not delete shadow rows but we can do that
      }, stmts)

    await this.adapter.runInTransaction(...stmts)
  }

  setClientListeners(): void {
    this.client.subscribeToRelations(this._updateRelations.bind(this))
    this.client.subscribeToTransactions(this._applyTransaction.bind(this))
    // When a local transaction is sent, or an acknowledgement for
    // a remote transaction commit is received, we update lsn records.
    this.client.subscribeToAck(async (lsn, type) => {
      const decoded = bytesToNumber(lsn)
      await this._ack(decoded, type == AckType.REMOTE_COMMIT)
    })
    this.client.subscribeToOutboundEvent('started', () =>
      this._throttledSnapshot!(),
    )

    this.client.subscribeToSubscriptionEvents(
      this._handleSubscriptionData.bind(this),
      this._handleSubscriptionError.bind(this),
    )
  }

  // Unsubscribe from data changes and stop polling
  async stop(): Promise<void> {
    // Stop snapshotting and polling for changes.
    if (this._throttledSnapshot !== undefined) {
      this._throttledSnapshot.cancel()
    }
    if (this._pollingInterval !== undefined) {
      clearInterval(this._pollingInterval)

      this._pollingInterval = undefined
    }

    if (this._authStateSubscription !== undefined) {
      this.notifier.unsubscribeFromAuthStateChanges(this._authStateSubscription)

      this._authStateSubscription = undefined
    }

    if (this._connectivityChangeSubscription !== undefined) {
      this.notifier.unsubscribeFromConnectivityStateChanges(
        this._connectivityChangeSubscription,
      )

      this._connectivityChangeSubscription = undefined
    }

    if (this._potentialDataChangeSubscription !== undefined) {
      this.notifier.unsubscribeFromPotentialDataChanges(
        this._potentialDataChangeSubscription,
      )

      this._potentialDataChangeSubscription = undefined
    }

    await this.client.close()
  }

  async subscribe(
    shapeDefinitions: ClientShapeDefinition[],
  ): Promise<ShapeSubscription> {
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
    // store the resolve and reject
    // such that we can resolve/reject
    // the promise later when the shape
    // is fulfilled or when an error arrives
    // we store it before making the actual request
    // to avoid that the answer would arrive too fast
    // and this resolver and rejecter would not yet be stored
    // this could especially happen in unit tests
    this.subscriptionNotifiers[subId] = emptyPromise()

    const { subscriptionId, error }: SubscribeResponse =
      await this.client.subscribe(subId, shapeReqs)
    if (subId !== subscriptionId) {
      throw new Error(
        `Expected SubscripeResponse for subscription id: ${subId} but got it for another id: ${subscriptionId}`,
      )
    }
    if (error) {
      delete this.subscriptionNotifiers[subscriptionId]
      this.subscriptions.subscriptionCancelled(subscriptionId)
      throw error
    }

    this.subscriptions.subscriptionRequested(subscriptionId, shapeReqs)

    return {
      synced: this.subscriptionNotifiers[subId].promise,
    }
  }

  async unsubscribe(_subscriptionId: string): Promise<void> {
    throw new SatelliteError(
      SatelliteErrorCode.INTERNAL,
      'unsubscribe shape not supported',
    )
    // return this.subscriptions.unsubscribe(subscriptionId)
  }

  async _handleSubscriptionData(subsData: SubscriptionData): Promise<void> {
    this.subscriptions.subscriptionDelivered(subsData)
    if (subsData.data) {
      await this._applySubscriptionData(subsData.data, subsData.lsn)
    }
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
    stmts.push({ sql: 'PRAGMA defer_foreign_keys = ON' })

    // It's much faster[1] to do less statements to insert the data instead of doing an insert statement for each row
    // so we're going to do just that, but with a caveat: SQLite has a max number of parameters in prepared statements,
    // so this is less of "insert all at once" and more of "insert in batches". This should be even more noticeable with
    // WASM builds, since we'll be crossing the JS-WASM boundary less.
    //
    // [1]: https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-insertions-971aff98eef2

    const groupedChanges = new Map<
      string,
      { columns: string[]; records: InitialDataChange['record'][] }
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

    // Disable trigger for all affected tables
    stmts.push(...this._disableTriggers([...groupedChanges.keys()]))

    // For each table, do a batched insert
    for (const [table, { columns, records }] of groupedChanges) {
      const sqlBase = `INSERT INTO ${table} (${columns.join(', ')}) VALUES `

      stmts.push(
        ...prepareBatchedStatements(
          sqlBase,
          columns,
          records as Record<string, SqlValue>[],
          this.maxSqlParameters
        )
      )
    }

    // And re-enable the triggers for all of them
    stmts.push(...this._enableTriggers([...groupedChanges.keys()]))

    // Then do a batched insert for the shadow table
    const upsertShadowStmt = `INSERT or REPLACE INTO ${this.opts.shadowTable.toString()} (namespace, tablename, primaryKey, tags) VALUES `
    stmts.push(
      ...prepareBatchedStatements(
        upsertShadowStmt,
        ['namespace', 'tablename', 'primaryKey', 'tags'],
        allArgsForShadowInsert,
        this.maxSqlParameters
      )
    )

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

  async _handleSubscriptionError(
    satelliteError: SatelliteError,
    subscriptionId?: string,
  ): Promise<void> {
    // this is obviously too conservative and note
    // that it does not update meta transactionally
    const ids = await this.subscriptions.unsubscribeAll()

    Log.error('Encountered a subscription error: ' + satelliteError.message)

    this._lsn = undefined
    await this.adapter.runInTransaction(
      this._setMetaStatement('lsn', null),
      this._setMetaStatement('subscriptions', this.subscriptions.serialize()),
    )

    await this.client.unsubscribe(ids)

    // Call the `onSuccess` callback for this subscription
    if (subscriptionId) {
      const { reject: onFailure } = this.subscriptionNotifiers[subscriptionId]
      delete this.subscriptionNotifiers[subscriptionId] // GC the notifiers for this subscription ID
      onFailure(satelliteError)
    }
  }

  async _connectivityStateChanged(status: ConnectivityState): Promise<void> {
    // TODO: no op if state is the same
    switch (status) {
      case 'available': {
        this.setClientListeners()
        return this._connectAndStartReplication()
      }
      case 'error':
      case 'disconnected': {
        return this.client.close()
      }
      case 'connected': {
        return
      }
      default: {
        throw new Error(`unexpected connectivity state: ${status}`)
      }
    }
  }

  async _connectAndStartReplication(
    opts?: SatelliteReplicationOptions,
  ): Promise<void> {
    Log.info(`connecting and starting replication`)

    if (!this._authState) {
      throw new Error(`trying to connect before authentication`)
    }
    const authState = this._authState

    try {
      await this.client.connect()
      await this.client.authenticate(authState)

      const schemaVersion = await this.migrator.querySchemaVersion()

      // Fetch the subscription IDs that were fulfilled
      // such that we can resume and inform Electric
      // about fulfilled subscriptions
      const subscriptionIds = this.subscriptions.getFulfilledSubscriptions()

      await this.client.startReplication(
        this._lsn,
        schemaVersion,
        subscriptionIds
      )
    } catch (error: any) {
      if (
        error.code == SatelliteErrorCode.BEHIND_WINDOW &&
        opts?.clearOnBehindWindow
      ) {
        return this._handleSubscriptionError(error).then(() =>
          this._connectAndStartReplication(),
        )
      }

      if (throwErrors.includes(error.code)) {
        throw error
      }
      Log.warn(`couldn't start replication: ${error}`)
      return Promise.resolve()
    }
  }

  async _verifyTableStructure(): Promise<boolean> {
    const meta = this.opts.metaTable.tablename
    const oplog = this.opts.oplogTable.tablename
    const shadow = this.opts.shadowTable.tablename

    const tablesExist = `
      SELECT count(name) as numTables FROM sqlite_master
        WHERE type='table'
        AND name IN (?, ?, ?)
    `

    const [{ numTables }] = await this.adapter.query({
      sql: tablesExist,
      args: [meta, oplog, shadow],
    })
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
  async _performSnapshot(): Promise<Date> {
    const timestamp = new Date()

    await this._updateOplogTimestamp(timestamp)
    const oplogEntries = await this._getUpdatedEntries(timestamp)

    const promises: Promise<void | RunResult>[] = []

    if (oplogEntries.length !== 0) {
      promises.push(this._notifyChanges(oplogEntries))

      const shadowEntries = new Map<string, ShadowEntry>()

      for (const oplogEntry of oplogEntries) {
        const [cached, shadowEntry] = await this._lookupCachedShadowEntry(
          oplogEntry,
          shadowEntries,
        )

        // Clear should not contain the tag for this timestamp, so if
        // the entry was previously in cache - it means, that we already
        // read it within the same snapshot
        if (cached) {
          oplogEntry.clearTags = encodeTags(
            difference(decodeTags(shadowEntry.tags), [
              this._generateTag(timestamp),
            ]),
          )
        } else {
          oplogEntry.clearTags = shadowEntry.tags
        }

        if (oplogEntry.optype == OPTYPES.delete) {
          shadowEntry.tags = shadowTagsDefault
        } else {
          const newTag = this._generateTag(timestamp)
          shadowEntry.tags = encodeTags([newTag])
        }

        promises.push(this._updateOplogEntryTags(oplogEntry))
        this._updateCachedShadowEntry(oplogEntry, shadowEntry, shadowEntries)
      }

      shadowEntries.forEach((value: ShadowEntry, _key: string) => {
        if (value.tags == shadowTagsDefault) {
          promises.push(this.adapter.run(this._deleteShadowTagsQuery(value)))
        } else {
          promises.push(this._updateShadowTags(value))
        }
      })
    }
    await Promise.all(promises)

    if (!this.client.isClosed()) {
      const { enqueued } = this.client.getOutboundLogPositions()
      const enqueuedLogPos = bytesToNumber(enqueued)

      // TODO: take next N transactions instead of all
      await this._getEntries(enqueuedLogPos).then((missing) =>
        this._replicateSnapshotChanges(missing),
      )
    }
    return timestamp
  }

  _updateCachedShadowEntry(
    oplogEntry: OplogEntry,
    shadowEntry: ShadowEntry,
    shadowEntries: Map<string, ShadowEntry>,
  ) {
    const pk = getShadowPrimaryKey(oplogEntry)
    const key: string = [oplogEntry.namespace, oplogEntry.tablename, pk].join(
      '.',
    )

    shadowEntries.set(key, shadowEntry)
  }

  async _lookupCachedShadowEntry(
    oplogEntry: OplogEntry,
    shadowEntries: Map<string, ShadowEntry>,
  ): Promise<[boolean, ShadowEntry]> {
    const pk = getShadowPrimaryKey(oplogEntry)
    const key: string = [oplogEntry.namespace, oplogEntry.tablename, pk].join(
      '.',
    )

    let shadowEntry: ShadowEntry
    if (shadowEntries.has(key)) {
      return [true, shadowEntries.get(key)!]
    } else {
      const shadowEntriesList = await this._getOplogShadowEntry(oplogEntry)
      if (shadowEntriesList.length == 0) {
        shadowEntry = newShadowEntry(oplogEntry)
      } else {
        shadowEntry = shadowEntriesList[0]
      }
      shadowEntries.set(key, shadowEntry)
      return [false, shadowEntry]
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
    if (this.client.isClosed()) {
      return
    }

    const transactions = toTransactions(results, this.relations)
    for (const txn of transactions) {
      return this.client.enqueueTransaction(txn)
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
    const merged = this._mergeEntries(
      this._authState!.clientId,
      local,
      incoming_origin,
      incoming,
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
        switch (entryChanges.optype) {
          case OPTYPES.delete:
            stmts.push(_applyDeleteOperation(entryChanges, tablenameStr))
            stmts.push(this._deleteShadowTagsQuery(shadowEntry))
            break

          default:
            stmts.push(_applyNonDeleteOperation(entryChanges, tablenameStr))
            stmts.push(this._updateShadowTagsQuery(shadowEntry))
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
    if (since === undefined) {
      since = this._lastAckdRowId
    }
    const oplog = this.opts.oplogTable.toString()

    const selectEntries = `
      SELECT * FROM ${oplog}
        WHERE timestamp IS NOT NULL
          AND rowid > ?
        ORDER BY rowid ASC
    `
    const rows = await this.adapter.query({ sql: selectEntries, args: [since] })
    return rows as unknown as OplogEntry[]
  }

  async _getUpdatedEntries(
    timestamp: Date,
    since?: number,
  ): Promise<OplogEntry[]> {
    if (since === undefined) {
      since = this._lastAckdRowId
    }
    const oplog = this.opts.oplogTable.toString()

    const selectChanges = `
      SELECT * FROM ${oplog}
      WHERE timestamp = ? AND
            rowid > ?
      ORDER BY rowid ASC
    `

    const rows = await this.adapter.query({
      sql: selectChanges,
      args: [timestamp.toISOString(), since],
    })
    return rows as unknown as OplogEntry[]
  }

  async _getOplogShadowEntry(
    oplog?: OplogEntry | undefined,
  ): Promise<ShadowEntry[]> {
    const shadow = this.opts.shadowTable.toString()
    let query
    let selectTags = `SELECT * FROM ${shadow}`
    if (oplog != undefined) {
      selectTags =
        selectTags +
        ` WHERE
         namespace = ? AND
         tablename = ? AND
         primaryKey = ?
      `
      const args = [
        oplog.namespace,
        oplog.tablename,
        getShadowPrimaryKey(oplog),
      ]
      query = { sql: selectTags, args: args }
    } else {
      query = { sql: selectTags }
    }

    const shadowTags = await this.adapter.query(query)
    return shadowTags as unknown as ShadowEntry[]
  }

  async _updateShadowTags(shadow: ShadowEntry): Promise<RunResult> {
    return await this.adapter.run(this._updateShadowTagsQuery(shadow))
  }

  _deleteShadowTagsQuery(shadow: ShadowEntry): Statement {
    const shadowTable = this.opts.shadowTable.toString()
    const deleteRow = `
      DELETE FROM ${shadowTable}
      WHERE namespace = ? AND
            tablename = ? AND
            primaryKey = ?;
    `
    return {
      sql: deleteRow,
      args: [shadow.namespace, shadow.tablename, shadow.primaryKey],
    }
  }

  _updateShadowTagsQuery(shadow: ShadowEntry): Statement {
    const shadowTable = this.opts.shadowTable.toString()
    const updateTags = `
      INSERT or REPLACE INTO ${shadowTable} (namespace, tablename, primaryKey, tags) VALUES
      (?, ?, ?, ?);
    `
    return {
      sql: updateTags,
      args: [
        shadow.namespace,
        shadow.tablename,
        shadow.primaryKey,
        shadow.tags,
      ],
    }
  }

  async _updateOplogEntryTags(oplog: OplogEntry): Promise<RunResult> {
    const oplogTable = this.opts.oplogTable.toString()
    const updateTags = `
      UPDATE ${oplogTable} set clearTags = ?
        WHERE rowid = ?
    `
    return await this.adapter.run({
      sql: updateTags,
      args: [oplog.clearTags, oplog.rowid],
    })
  }

  async _updateOplogTimestamp(timestamp: Date): Promise<void> {
    const oplog = this.opts.oplogTable.toString()

    const updateTimestamps = `
      UPDATE ${oplog} set timestamp = ?
        WHERE rowid in (
          SELECT rowid FROM ${oplog}
              WHERE timestamp is NULL
              AND rowid > ?
          ORDER BY rowid ASC
          )
    `

    const updateArgs = [timestamp.toISOString(), `${this._lastAckdRowId}`]
    await this.adapter.run({ sql: updateTimestamps, args: updateArgs })
  }

  // Merge changes, with last-write-wins and add-wins semantics.
  // clearTags field is used by the calling code to determine new value of
  // the shadowTags
  _mergeEntries(
    local_origin: string,
    local: OplogEntry[],
    incoming_origin: string,
    incoming: OplogEntry[],
  ): ShadowTableChanges {
    const localTableChanges = localOperationsToTableChanges(
      local,
      (timestamp: Date) => {
        return generateTag(local_origin, timestamp)
      },
    )
    const incomingTableChanges = remoteOperationsToTableChanges(incoming)

    for (const [tablename, incomingMapping] of Object.entries(
      incomingTableChanges,
    )) {
      const localMapping = localTableChanges[tablename]

      if (localMapping === undefined) {
        continue
      }

      for (const [primaryKey, incomingChanges] of Object.entries(
        incomingMapping,
      )) {
        const localInfo = localMapping[primaryKey]
        if (localInfo === undefined) {
          continue
        }
        const [_, localChanges] = localInfo

        const changes = mergeChangesLastWriteWins(
          local_origin,
          localChanges.changes,
          incoming_origin,
          incomingChanges.changes,
          incomingChanges.fullRow,
        )
        let optype

        const tags = mergeOpTags(localChanges, incomingChanges)
        if (tags.length == 0) {
          optype = OPTYPES.delete
        } else {
          optype = OPTYPES.upsert
        }

        Object.assign(incomingChanges, { changes, optype, tags })
      }
    }

    return incomingTableChanges
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
    stmts.push({ sql: 'PRAGMA defer_foreign_keys = ON' })
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
        await this._performSnapshot()
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
          const affectedTable = change.table.name
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
        const triggers = generateTriggersForTable(table)
        stmts.push(...triggers)
        txStmts.push(...triggers)
      })

      // Disable the newly created triggers
      // during the processing of this transaction
      stmts.push(...this._disableTriggers([...createdTables]))
      newTables = new Set([...newTables, ...createdTables])
    }

    // Now process all changes per chunk.
    // We basically take a prefix of changes of the same type
    // which we call a `dmlChunk` or `ddlChunk` if the changes
    // are DML statements, respectively, DDL statements.
    // We process chunk per chunk in-order.
    let dmlChunk: DataChange[] = []
    let ddlChunk: SchemaChange[] = []

    const changes = transaction.changes
    for (let idx = 0; idx < changes.length; idx++) {
      const change = changes[idx]
      const changeType = (change: Chg): 'DML' | 'DDL' => {
        return isDataChange(change) ? 'DML' : 'DDL'
      }
      const sameChangeTypeAsPrevious = (): boolean => {
        return (
          idx == 0 || changeType(changes[idx]) === changeType(changes[idx - 1])
        )
      }
      const addToChunk = (change: Chg) => {
        if (isDataChange(change)) dmlChunk.push(change)
        else ddlChunk.push(change)
      }
      const processChunk = async (type: 'DML' | 'DDL') => {
        if (type === 'DML') {
          await processDML(dmlChunk)
          dmlChunk = []
        } else {
          await processDDL(ddlChunk)
          ddlChunk = []
        }
      }

      addToChunk(change) // add the change in the right chunk
      if (!sameChangeTypeAsPrevious()) {
        // We're starting a new chunk
        // process the previous chunk and clear it
        const previousChange = changes[idx - 1]
        await processChunk(changeType(previousChange))
      }

      if (idx === changes.length - 1) {
        // we're at the last change
        // process this chunk
        const thisChange = changes[idx]
        await processChunk(changeType(thisChange))
      }
    }

    // Now run the DML and DDL statements in-order in a transaction
    const tablenames = Array.from(tablenamesSet)
    const notNewTableNames = tablenames.filter((t) => !newTables.has(t))

    const allStatements = this._disableTriggers(notNewTableNames)
      .concat(stmts)
      .concat(this._enableTriggers(tablenames))

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

    await this.notifyChangesAndGCopLog(opLogEntries, origin, commitTimestamp)
  }

  private async notifyChangesAndGCopLog(
    oplogEntries: OplogEntry[],
    origin: string,
    commitTimestamp: Date,
  ) {
    await this._notifyChanges(oplogEntries)

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

  _disableTriggers(tablenames: string[]): Statement[] {
    return this._updateTriggerSettings(tablenames, 0)
  }

  _enableTriggers(tablenames: string[]): Statement[] {
    return this._updateTriggerSettings(tablenames, 1)
  }

  _updateTriggerSettings(tablenames: string[], flag: 0 | 1): Statement[] {
    const triggers = this.opts.triggersTable.toString()
    if (tablenames.length > 0)
      return [
        {
          sql: `UPDATE ${triggers} SET flag = ? WHERE ${tablenames
            .map(() => 'tablename = ?')
            .join(' OR ')}`,
          args: [flag, ...tablenames],
        },
      ]
    else return []
  }

  async _ack(lsn: number, isAck: boolean): Promise<void> {
    if (lsn < this._lastAckdRowId || (lsn > this._lastSentRowId && isAck)) {
      throw new Error('Invalid position')
    }

    const meta = this.opts.metaTable.toString()

    const sql = ` UPDATE ${meta} SET value = ? WHERE key = ?`
    const args = [
      `${lsn.toString()}`,
      isAck ? 'lastAckdRowId' : 'lastSentRowId',
    ]

    if (isAck) {
      this._lastAckdRowId = lsn
      await this.adapter.runInTransaction({ sql, args })
    } else {
      this._lastSentRowId = lsn
      await this.adapter.run({ sql, args })
    }
  }

  _setMetaStatement(key: string, value: SqlValue): Statement {
    const meta = this.opts.metaTable.toString()

    const sql = `UPDATE ${meta} SET value = ? WHERE key = ?`
    const args = [value, key]
    return { sql, args }
  }

  async _setMeta(key: string, value: SqlValue): Promise<void> {
    const stmt = this._setMetaStatement(key, value)
    await this.adapter.run(stmt)
  }

  async _getMeta(key: string): Promise<string> {
    const meta = this.opts.metaTable.toString()

    const sql = `SELECT value from ${meta} WHERE key = ?`
    const args = [key]
    const rows = await this.adapter.query({ sql, args })

    if (rows.length !== 1) {
      throw `Invalid metadata table: missing ${key}`
    }

    return rows[0].value as string
  }

  private async _getClientId(): Promise<string> {
    const clientIdKey = 'clientId'

    let clientId: string = await this._getMeta(clientIdKey)

    if (clientId === '') {
      clientId = uuid() as string
      await this._setMeta(clientIdKey, clientId)
    }
    return clientId
  }

  private async _getLocalTableNames(): Promise<Row[]> {
    const notIn = [
      this.opts.metaTable.tablename.toString(),
      this.opts.migrationsTable.tablename.toString(),
      this.opts.oplogTable.tablename.toString(),
      this.opts.triggersTable.tablename.toString(),
      this.opts.shadowTable.tablename.toString(),
      'sqlite_schema',
      'sqlite_sequence',
      'sqlite_temp_schema',
    ]

    const tables = `
      SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT IN (${notIn.map(() => '?').join(',')})
    `
    return await this.adapter.query({ sql: tables, args: notIn })
  }

  // Fetch primary keys from local store and use them to identify incoming ops.
  // TODO: Improve this code once with Migrator and consider simplifying oplog.
  private async _getLocalRelations(): Promise<{ [k: string]: Relation }> {
    const tableNames = await this._getLocalTableNames()
    const relations: RelationsCache = {}

    let id = 0
    const schema = 'public' // TODO
    for (const table of tableNames) {
      const tableName = table.name as any
      const sql = 'SELECT * FROM pragma_table_info(?)'
      const args = [tableName]
      const columnsForTable = await this.adapter.query({ sql, args })
      if (columnsForTable.length == 0) {
        continue
      }
      const relation: Relation = {
        id: id++,
        schema: schema,
        table: tableName,
        tableType: SatRelation_RelationType.TABLE,
        columns: [],
      }
      for (const c of columnsForTable) {
        relation.columns.push({
          name: c.name!.toString(),
          type: c.type!.toString(),
          primaryKey: Boolean(c.pk!.valueOf()),
        })
      }
      relations[`${tableName}`] = relation
    }

    return Promise.resolve(relations)
  }

  private _generateTag(timestamp: Date): string {
    const instanceId = this._authState!.clientId
    return generateTag(instanceId, timestamp)
  }

  async _garbageCollectOplog(commitTimestamp: Date) {
    const isoString = commitTimestamp.toISOString()
    const oplog = this.opts.oplogTable.tablename.toString()
    const stmt = `
      DELETE FROM ${oplog}
      WHERE timestamp = ?;
    `
    await this.adapter.run({ sql: stmt, args: [isoString] })
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
    return {
      sql: `UPDATE ${this.opts.metaTable.tablename} set value = ? WHERE key = ?`,
      args: [lsn_base64, 'lsn'],
    }
  }

  private async checkMaxSqlParameters() {
    const [{ version }] = (await this.adapter.query({
      sql: 'SELECT sqlite_version() AS version',
    })) as [{ version: string }]

    const [major, minor, _patch] = version.split('.').map((x) => parseInt(x))

    if (major === 3 && minor >= 32) this.maxSqlParameters = 32766
    else this.maxSqlParameters = 999
  }
}

function _applyDeleteOperation(
  entryChanges: ShadowEntryChanges,
  tablenameStr: string,
): Statement {
  const pkEntries = Object.entries(entryChanges.primaryKeyCols)
  if (pkEntries.length === 0)
    throw new Error(
      "Can't apply delete operation. None of the columns in changes are marked as PK.",
    )
  const params = pkEntries.reduce(
    (acc, [column, value]) => {
      acc.where.push(`${column} = ?`)
      acc.values.push(value)
      return acc
    },
    { where: [] as string[], values: [] as SqlValue[] },
  )

  return {
    sql: `DELETE FROM ${tablenameStr} WHERE ${params.where.join(' AND ')}`,
    args: params.values,
  }
}

function _applyNonDeleteOperation(
  { fullRow, primaryKeyCols }: ShadowEntryChanges,
  tablenameStr: string,
): Statement {
  const columnNames = Object.keys(fullRow)
  const columnValues = Object.values(fullRow)
  let insertStmt = `INTO ${tablenameStr}(${columnNames.join(
    ', ',
  )}) VALUES (${columnValues.map((_) => '?').join(',')})`

  const updateColumnStmts = columnNames
    .filter((c) => !(c in primaryKeyCols))
    .reduce(
      (acc, c) => {
        acc.where.push(`${c} = ?`)
        acc.values.push(fullRow[c])
        return acc
      },
      { where: [] as string[], values: [] as SqlValue[] },
    )

  if (updateColumnStmts.values.length > 0) {
    insertStmt = `
                INSERT ${insertStmt} 
                ON CONFLICT DO UPDATE SET ${updateColumnStmts.where.join(', ')}
              `
    columnValues.push(...updateColumnStmts.values)
  } else {
    // no changes, can ignore statement if exists
    insertStmt = `INSERT OR IGNORE ${insertStmt}`
  }

  return { sql: insertStmt, args: columnValues }
}

export function generateTriggersForTable(tbl: MigrationTable): Statement[] {
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
  }
  const fullTableName = table.namespace + '.' + table.tableName
  return generateOplogTriggers(fullTableName, table)
}
