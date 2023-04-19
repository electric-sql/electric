import throttle from 'lodash.throttle'

import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import {
  AuthStateNotification,
  Change,
  ConnectivityStateChangeNotification,
  Notifier,
} from '../notifiers/index'
import { Client, ConnectionWrapper, ConsoleClient } from './index'
import { QualifiedTablename } from '../util/tablename'
import {
  AckType,
  ConnectivityState,
  DbName,
  LSN,
  Relation,
  RelationsCache,
  SatelliteError,
  SqlValue,
  Statement,
  Transaction,
} from '../util/types'
import { Satellite } from './index'
import { SatelliteConfig, SatelliteOpts } from './config'
import { mergeChangesLastWriteWins, mergeOpTags } from './merge'
import { difference } from '../util/sets'
import {
  OPTYPES,
  OplogEntry,
  ShadowTableChanges,
  localOperationsToTableChanges,
  remoteOperationsToTableChanges,
  fromTransaction,
  toTransactions,
  ShadowEntryChanges,
  encodeTags,
  decodeTags,
  ShadowEntry,
  shadowTagsDefault,
  newShadowEntry,
  getShadowPrimaryKey,
  generateTag,
} from './oplog'
import { SatRelation_RelationType } from '../_generated/protocol/satellite'
import { base64, bytesToNumber, numberToBytes, uuid } from '../util/common'
import { RunResult } from '../electric/adapter'

import Log from 'loglevel'

type ChangeAccumulator = {
  [key: string]: Change
}

export class SatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  client: Client
  console: ConsoleClient

  config: SatelliteConfig
  opts: SatelliteOpts

  _authState?: AuthState
  _authStateSubscription?: string

  _lastSnapshotTimestamp?: Date
  _pollingInterval?: any
  _potentialDataChangeSubscription?: string
  _connectivityChangeSubscription?: string
  _throttledSnapshot: () => void

  _lastAckdRowId: number
  _lastSentRowId: number
  _lsn?: LSN

  relations: RelationsCache

  constructor(
    dbName: DbName,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    client: Client,
    console: ConsoleClient,
    config: SatelliteConfig,
    opts: SatelliteOpts
  ) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.client = client
    this.console = console

    this.config = config
    this.opts = opts

    this._lastAckdRowId = 0
    this._lastSentRowId = 0

    // Create a throttled function that performs a snapshot at most every
    // `minSnapshotWindow` ms. This function runs immediately when you
    // first call it and then every `minSnapshotWindow` ms as long as
    // you keep calling it within the window. If you don't call it within
    // the window, it will then run immediately the next time you call it.
    const snapshot = this._performSnapshot.bind(this)
    const throttleOpts = { leading: true, trailing: true }
    this._throttledSnapshot = throttle(
      snapshot,
      opts.minSnapshotWindow,
      throttleOpts
    )

    this.relations = {}
  }

  async start(authState?: AuthState): Promise<ConnectionWrapper> {
    await this.migrator.up()

    const isVerified = await this._verifyTableStructure()
    if (!isVerified) {
      throw new Error('Invalid database schema.')
    }

    await this._setAuthState(authState)

    if (this._authStateSubscription === undefined) {
      const handler = this._updateAuthState.bind(this)
      this._authStateSubscription =
        this.notifier.subscribeToAuthStateChanges(handler)
    }

    // XXX establish replication connection,
    // validate auth state, etc here.

    // Request a snapshot whenever the data in our database potentially changes.
    this._potentialDataChangeSubscription =
      this.notifier.subscribeToPotentialDataChanges(this._throttledSnapshot)

    const connectivityChangeCallback = (
      notification: ConnectivityStateChangeNotification
    ) => {
      this._connectivityStateChange(notification.connectivityState)
    }
    this._connectivityChangeSubscription =
      this.notifier.subscribeToConnectivityStateChange(
        connectivityChangeCallback
      )

    // Start polling to request a snapshot every `pollingInterval` ms.
    this._pollingInterval = setInterval(
      this._throttledSnapshot,
      this.opts.pollingInterval
    )

    // Starting now!
    setTimeout(this._throttledSnapshot, 0)

    // Need to reload primary keys after schema migration
    // For now, we do it only at initialization
    this.relations = await this._getLocalRelations()

    this._lastAckdRowId = Number(await this._getMeta('lastAckdRowId'))
    this._lastSentRowId = Number(await this._getMeta('lastSentRowId'))

    this.setClientListeners()
    this.client.resetOutboundLogPositions(
      numberToBytes(this._lastAckdRowId),
      numberToBytes(this._lastSentRowId)
    )

    const lsnBase64 = await this._getMeta('lsn')
    if (lsnBase64 && lsnBase64.length > 0) {
      Log.info(`retrieved lsn ${this._lsn}`)
      this._lsn = base64.toBytes(lsnBase64)
    } else {
      Log.info(`no lsn retrieved from store`)
    }

    const connectionPromise = this._connectAndStartReplication()
    return { connectionPromise }
  }

  async _setAuthState(authState?: AuthState): Promise<void | Error> {
    if (authState !== undefined) {
      throw new Error('Not implemented')
      // this._authState = authState
    } else {
      const app = this.config.app
      const env = this.config.env
      const clientId = await this._getClientId()
      const token = await this._getMeta('token')
      const refreshToken = await this._getMeta('refreshToken')

      this._authState = { app, env, clientId, token, refreshToken }
    }
  }

  setClientListeners(): void {
    this.client.subscribeToTransactions(async (transaction: Transaction) => {
      this._applyTransaction(transaction)
    })
    // When a local transaction is sent, or an acknowledgement for
    // a remote transaction commit is received, we update lsn records.
    this.client.subscribeToAck(async (lsn, type) => {
      const decoded = bytesToNumber(lsn)
      await this._ack(decoded, type == AckType.REMOTE_COMMIT)
    })
    this.client.subscribeToOutboundEvent('started', () =>
      this._throttledSnapshot()
    )
  }

  // Unsubscribe from data changes and stop polling
  async stop(): Promise<void> {
    Log.info('stop polling')
    if (this._pollingInterval !== undefined) {
      clearInterval(this._pollingInterval)
      this._pollingInterval = undefined
    }

    if (this._potentialDataChangeSubscription !== undefined) {
      this.notifier.unsubscribeFromPotentialDataChanges(
        this._potentialDataChangeSubscription
      )
      this._potentialDataChangeSubscription = undefined
    }

    await this.client.close()
  }

  async _connectivityStateChange(
    status: ConnectivityState
  ): Promise<void | SatelliteError> {
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

  async _connectAndStartReplication(): Promise<void | SatelliteError> {
    Log.info(`connecting and starting replication`)

    if (!this._authState) {
      throw new Error(`trying to connect before authentication`)
    }
    const authState = this._authState

    return this.client
      .connect()
      .then(() => this.refreshAuthState(authState))
      .then((freshAuthState) => this.client.authenticate(freshAuthState))
      .then(() => this.client.startReplication(this._lsn))
      .catch((error) => {
        Log.warn(`couldn't start replication: ${error}`)
      })
  }

  // TODO: fetch token every time, must add logic to check if token is still valid
  async refreshAuthState(authState: AuthState): Promise<AuthState> {
    try {
      const { token, refreshToken } = await this.console.token(authState)
      await this._setMeta('token', token)
      await this._setMeta('refreshToken', token)
      return { ...authState, token, refreshToken }
    } catch (error) {
      Log.warn(`unable to refresh token: ${error}`)
    }

    return { ...authState }
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

    const promises: Promise<void | SatelliteError | RunResult>[] = []

    if (oplogEntries.length !== 0) {
      promises.push(this._notifyChanges(oplogEntries))

      const shadowEntries = new Map<string, ShadowEntry>()

      for (const oplogEntry of oplogEntries) {
        const [cached, shadowEntry] = await this._lookupCachedShadowEntry(
          oplogEntry,
          shadowEntries
        )

        // Clear should not contain the tag for this timestamp, so if
        // the entry was previously in cache - it means, that we already
        // read it within the same snapshot
        if (cached) {
          oplogEntry.clearTags = encodeTags(
            difference(decodeTags(shadowEntry.tags), [
              this._generateTag(timestamp),
            ])
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
        this._replicateSnapshotChanges(missing)
      )
    }
    return timestamp
  }

  _updateCachedShadowEntry(
    oplogEntry: OplogEntry,
    shadowEntry: ShadowEntry,
    shadowEntries: Map<string, ShadowEntry>
  ) {
    const pk = getShadowPrimaryKey(oplogEntry)
    const key: string = [oplogEntry.namespace, oplogEntry.tablename, pk].join(
      '.'
    )

    shadowEntries.set(key, shadowEntry)
  }

  async _lookupCachedShadowEntry(
    oplogEntry: OplogEntry,
    shadowEntries: Map<string, ShadowEntry>
  ): Promise<[boolean, ShadowEntry]> {
    const pk = getShadowPrimaryKey(oplogEntry)
    const key: string = [oplogEntry.namespace, oplogEntry.tablename, pk].join(
      '.'
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

  async _replicateSnapshotChanges(
    results: OplogEntry[]
  ): Promise<void | SatelliteError> {
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
  async _apply(
    incoming: OplogEntry[],
    incoming_origin: string,
    lsn: LSN
  ): Promise<void> {
    Log.info(`apply incoming changes for LSN: ${lsn}`)
    // assign timestamp to pending operations before apply
    await this._performSnapshot()

    const local = await this._getEntries()
    const merged = this._mergeEntries(
      this._authState!.clientId,
      local,
      incoming_origin,
      incoming
    )

    const stmts: Statement[] = []
    // switches off on transaction commit/abort
    stmts.push({ sql: 'PRAGMA defer_foreign_keys = ON' })
    // update lsn.
    this._lsn = lsn
    const lsn_base64 = base64.fromBytes(lsn)
    stmts.push({
      sql: `UPDATE ${this.opts.metaTable.tablename} set value = ? WHERE key = ?`,
      args: [lsn_base64, 'lsn'],
    })

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

    await this.adapter.runInTransaction(
      ...this._disableTriggers(tablenames),
      ...stmts,
      ...this._enableTriggers(tablenames)
    )
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
    since?: number
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
    oplog: OplogEntry | undefined
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
    incoming: OplogEntry[]
  ): ShadowTableChanges {
    const localTableChanges = localOperationsToTableChanges(
      local,
      (timestamp: Date) => {
        return generateTag(local_origin, timestamp)
      }
    )
    const incomingTableChanges = remoteOperationsToTableChanges(incoming)

    for (const [tablename, incomingMapping] of Object.entries(
      incomingTableChanges
    )) {
      const localMapping = localTableChanges[tablename]

      if (localMapping === undefined) {
        continue
      }

      for (const [primaryKey, incomingChanges] of Object.entries(
        incomingMapping
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
          incomingChanges.changes
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

  async _applyTransaction(transaction: Transaction) {
    const origin = transaction.origin!

    const opLogEntries = fromTransaction(transaction, this.relations)
    const commitTimestamp = new Date(transaction.commit_timestamp.toNumber())
    await this._applyTransactionInternal(
      origin,
      commitTimestamp,
      opLogEntries,
      transaction.lsn
    )
  }

  async _applyTransactionInternal(
    origin: string,
    commitTimestamp: Date,
    opLogEntries: OplogEntry[],
    lsn: LSN
  ) {
    await this._apply(opLogEntries, origin, lsn)
    await this._notifyChanges(opLogEntries)

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
    const stmts = tablenames.map((tablenameStr) => ({
      sql: `UPDATE ${triggers} SET flag = ? WHERE tablename = ?`,
      args: [flag, tablenameStr],
    }))
    return stmts
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
      await this.adapter.runInTransaction({ sql, args })
    }
  }

  async _setMeta(key: string, value: SqlValue): Promise<void> {
    const meta = this.opts.metaTable.toString()

    const sql = `UPDATE ${meta} SET value = ? WHERE key = ?`
    const args = [value, key]

    await this.adapter.run({ sql, args })
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

  // Fetch primary keys from local store and use them to identify incoming ops.
  // TODO: Improve this code once with Migrator and consider simplifying oplog.
  private async _getLocalRelations(): Promise<{ [k: string]: Relation }> {
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
    const tableNames = await this.adapter.query({ sql: tables, args: notIn })

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
}

function _applyDeleteOperation(
  entryChanges: ShadowEntryChanges,
  tablenameStr: string
): Statement {
  const pkEntries = Object.entries(entryChanges.primaryKeyCols)
  const params = pkEntries.reduce(
    (acc, [column, value]) => {
      acc.where.push(`${column} = ?`)
      acc.values.push(value)
      return acc
    },
    { where: [] as string[], values: [] as SqlValue[] }
  )

  return {
    sql: `DELETE FROM ${tablenameStr} WHERE ${params.where.join(' AND ')}`,
    args: params.values,
  }
}

function _applyNonDeleteOperation(
  { changes, primaryKeyCols }: ShadowEntryChanges,
  tablenameStr: string
): Statement {
  const columnNames = Object.keys(changes)
  const columnValues = Object.values(changes).map((c) => c.value)
  let insertStmt = `INTO ${tablenameStr}(${columnNames.join(
    ', '
  )}) VALUES (${columnValues.map((_) => '?').join(',')})`

  const updateColumnStmts = columnNames
    .filter((c) => !(c in primaryKeyCols))
    .reduce(
      (acc, c) => {
        acc.where.push(`${c} = ?`)
        acc.values.push(changes[c].value)
        return acc
      },
      { where: [] as string[], values: [] as SqlValue[] }
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
