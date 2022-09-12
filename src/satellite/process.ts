import throttle from 'lodash.throttle'

import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { AuthStateNotification, Change, Notifier } from '../notifiers/index'
import { QualifiedTablename } from '../util/tablename'
import { DbName } from '../util/types'

import { Satellite } from './index'
import { SatelliteOpts } from './config'
import { mergeChangesLastWriteWins, mergeOpTypesAddWins } from './merge'
import { OPTYPES, OplogEntry, OplogTableChanges, operationsToTableChanges } from './oplog'

type ChangeAccumulator = {
  [key: string]: Change
}

export class SatelliteProcess implements Satellite {
  dbName: DbName
  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier
  opts: SatelliteOpts

  _authState?: AuthState
  _authStateSubscription?: string

  _lastSnapshotTimestamp?: Date
  _pollingInterval?: any
  _potentialDataChangeSubscription?: string
  _throttledSnapshot: () => void

  _lastAckdRowId: number
  _lastSentRowId: number

  constructor(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, opts: SatelliteOpts) {
    this.dbName = dbName
    this.adapter = adapter
    this.migrator = migrator
    this.notifier = notifier
    this.opts = opts

    // The last rowid that was *acknowledged by* the server.
    this._lastAckdRowId = opts.lastAckdRowId
    // The last rowid that was *sent to* the server.
    this._lastSentRowId = opts.lastSentRowId

    // Create a throttled function that performs a snapshot at most every
    // `minSnapshotWindow` ms. This function runs immediately when you
    // first call it and then every `minSnapshotWindow` ms as long as
    // you keep calling it within the window. If you don't call it within
    // the window, it will then run immediately the next time you call it.
    const snapshot = this._performSnapshot.bind(this)
    const throttleOpts = {leading: true, trailing: true}
    this._throttledSnapshot = throttle(snapshot, opts.minSnapshotWindow, throttleOpts)
  }

  // XXX kick off the satellite process
  //
  // - [x] poll the ops table
  // - [x] subscribe to data changes
  // - [ ] handle auth state
  // - [ ] establish replication connection
  // - [ ] ...
  //
  async start(authState?: AuthState): Promise<void>{
    const isVerified = await this._verifyTableStructure()
    if (!isVerified) {
      throw new Error('Invalid database schema. You need to run valid Electric SQL migrations.')
    }

    if (authState !== undefined) {
      this._authState = authState
    }

    if (this._authStateSubscription === undefined) {
      const handler = this._updateAuthState.bind(this)
      this._authStateSubscription = this.notifier.subscribeToAuthStateChanges(handler)
    }

    // XXX establish replication connection,
    // validate auth state, etc here.

    // Request a snapshot whenever the data in our database potentially changes.
    this._potentialDataChangeSubscription = this.notifier.subscribeToPotentialDataChanges(this._throttledSnapshot)

    // Start polling to request a snapshot every `pollingInterval` ms.
    this._pollingInterval = setInterval(this._throttledSnapshot, this.opts.pollingInterval)

    // Starting now!
    setTimeout(this._throttledSnapshot, 0)
  }

  // Unsubscribe from data changes and stop polling
  async stop(): Promise<void> {
    if (this._pollingInterval !== undefined) {
      clearInterval(this._pollingInterval)
      this._pollingInterval = undefined
    }

    if (this._potentialDataChangeSubscription !== undefined) {
      this.notifier.unsubscribeFromPotentialDataChanges(this._potentialDataChangeSubscription)
      this._potentialDataChangeSubscription = undefined
    }
  }

  async _verifyTableStructure(): Promise<boolean> {
    const meta = this.opts.metaTable.tablename
    const oplog = this.opts.oplogTable.tablename

    const tablesExist = `
      SELECT count(name) as numTables FROM sqlite_master
        WHERE type='table'
          AND name IN (?, ?)
    `

    const [{ numTables }] = await this.adapter.query(tablesExist, [meta, oplog])
    return numTables === 2
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
  async _performSnapshot(): Promise<void> {
    const oplog = this.opts.oplogTable.toString()
    const timestamp = new Date().toISOString()

    const updateTimestamps = `
      UPDATE ${oplog} set timestamp = '${timestamp}'
        WHERE rowid in (
          SELECT rowid FROM ${oplog}
            WHERE timestamp is NULL
              AND rowid > ${this._lastAckdRowId}
            ORDER BY rowid ASC
        )
    `

    const selectChanges = `
      SELECT * FROM ${oplog}
        WHERE timestamp = ?
        ORDER BY rowid ASC
    `

    // XXX currently this timestamps and fetches the new oplog entries. We still
    // need to actually replicate the data changes ...
    await this.adapter.run(updateTimestamps)
    const rows = await this.adapter.query(selectChanges, [timestamp])
    const results = rows as unknown as OplogEntry[]

    if (results.length === 0) {
      return
    }

    await Promise.all([
      this._notifySnapshotChanges(results),
      this._replicateSnapshotChanges(results)
    ])
  }
  async _notifySnapshotChanges(results: OplogEntry[]): Promise<void> {
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
      }
      else {
        acc[key] = {
          qualifiedTablename: qt,
          rowids: [entry.rowid]
        }
      }

      return acc
    }

    const changes = Object.values(results.reduce(reduceFn, acc))
    this.notifier.actuallyChanged(this.dbName, changes)
  }
  async _replicateSnapshotChanges(_results: OplogEntry[]): Promise<void> {
    // XXX integrate replication here ...
  }

  // Apply a set of incoming transactions agains pending local operations,
  // applying conflict resolution rules. Takes all changes per each key
  // before merging, for local and remote operations.
  //
  // XXX Todo: enforce that all operations in the oplog have a timestamp
  // before running apply.
  async _apply(incoming: OplogEntry[]): Promise<void> {
    const local = await this._getEntries()
    const merged = this._mergeEntries(local, incoming)

    const stmts: string[] = []

    for (const [tablenameStr, mapping] of Object.entries(merged)) {
      for (const entryChanges of Object.values(mapping)) {
        const { changes, primaryKeys, optype } = entryChanges

        if (optype === OPTYPES.delete) {
          const clauses = Object.entries(primaryKeys).map(([key, value]) => {
            return typeof value === 'number'
              ? `${key} = ${value}`
              : `${key} = '${value}'`
          })

          const deleteStmt = `
            DELETE FROM ${tablenameStr}
              WHERE ${clauses.join(' AND ')}
          `

          stmts.push(deleteStmt)
        }
        else { // XXX Does this code need to handle types more reliably?
          const columnNames = Object.keys(changes)
          const columnValues = Object.values(changes).map(({ value }) => {
            return typeof value === 'number'
              ? `${value}`
              : `'${value}'`
          })
          const updateColumnStmts = columnNames.map((name, i) => `${name} = ${columnValues[i]}`)

          const insertStmt = `
            INSERT INTO ${tablenameStr}
              (${columnNames.join(', ')})
              VALUES (${columnValues.join(', ')})
              ON CONFLICT DO UPDATE SET ${updateColumnStmts.join(', ')}
          `

          stmts.push(insertStmt)
        }
      }
    }

    const sql = `
      PRAGMA defer_foreign_keys = ON;
      BEGIN;
        ${stmts.join('; ')};
      COMMIT;
      PRAGMA defer_foreign_keys = OFF
    `

    const tablenames = Object.keys(merged)
    await this._disableTriggers(tablenames)
    await this.adapter.run(sql)
    await this._enableTriggers(tablenames)
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

    const rows = await this.adapter.query(selectEntries, [since])
    return rows as unknown as OplogEntry[]
  }

  // Merge changes, with last-write-wins and add-wins semantics.
  _mergeEntries(local: OplogEntry[], incoming: OplogEntry[]): OplogTableChanges {
    const localTableChanges = operationsToTableChanges(local)
    const incomingTableChanges = operationsToTableChanges(incoming)

    for (const [tablename, incomingMapping] of Object.entries(incomingTableChanges)) {
      const localMapping = localTableChanges[tablename]

      if (localMapping === undefined) {
        continue
      }

      for (const [primaryKey, incomingChanges] of Object.entries(incomingMapping)) {
        const localChanges = localMapping[primaryKey]

        if (localChanges === undefined) {
          continue
        }

        const changes = mergeChangesLastWriteWins(localChanges.changes, incomingChanges.changes)
        const optype = mergeOpTypesAddWins(localChanges.optype, incomingChanges.optype)

        Object.assign(incomingChanges, { changes, optype })
      }
    }

    return incomingTableChanges
  }

  async _disableTriggers(tablenames: string[]): Promise<void> {
    return this._updateTriggerSettings(tablenames, 0)
  }
  async _enableTriggers(tablenames: string[]): Promise<void> {
    return this._updateTriggerSettings(tablenames, 1)
  }
  async _updateTriggerSettings(tablenames: string[], flag: 0 | 1): Promise<void> {
    const stmts = tablenames.map((tablenameStr) => `
      UPDATE trigger_settings
         SET flag = ${flag}
       WHERE tablename = '${tablenameStr}'
    `)

    await this.adapter.run(stmts.join('; '))
  }

  // Clean up the oplog and update `this._lastAckdRowId`.
  async _ack(rowId: number): Promise<void> {
    const lastAckd = this._lastAckdRowId
    const lastSent = this._lastSentRowId

    if (rowId < lastAckd || rowId > lastSent) {
      throw new Error('Invalid position')
    }

    const meta = this.opts.metaTable.toString()
    const oplog = this.opts.oplogTable.toString()

    const sql = `
      DELETE FROM ${oplog}
        WHERE rowid <= ${rowId};

      UPDATE ${meta}
         SET value='${rowId}'
       WHERE key='ackRowId'
    `

    await this.adapter.run(sql)
    this._lastAckdRowId = rowId
  }

  async _setMeta(key: string, value: SqlValue): Promise<void> {
    const meta = this.opts.metaTable.toString()

    const sql = `
      UPDATE ${meta}
         SET value='${value}'
       WHERE key='${key}'
    `

    await this.adapter.run(sql)
  }
}
