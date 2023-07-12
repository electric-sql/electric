import { mkdir, rm as removeFile } from 'node:fs/promises'
import {
  ConnectivityState,
  DataTransaction,
  LSN,
  Relation,
  RelationsCache,
  SqlValue,
  randomValue,
} from '../../src/util'
import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { BundleMigrator } from '../../src/migrators'
import { EventNotifier, MockNotifier } from '../../src/notifiers'
import { MockSatelliteClient } from '../../src/satellite/mock'
import { Satellite, SatelliteProcess } from '../../src/satellite'
import { TableInfo, initTableInfo } from '../support/satellite-helpers'
import { satelliteDefaults, SatelliteOpts } from '../../src/satellite/config'

export const relations = {
  child: {
    id: 0,
    schema: 'public',
    table: 'child',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        primaryKey: true,
      },
      {
        name: 'parent',
        type: 'INTEGER',
        primaryKey: false,
      },
    ],
  },
  parent: {
    id: 1,
    schema: 'public',
    table: 'parent',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        primaryKey: true,
      },
      {
        name: 'value',
        type: 'TEXT',
        primaryKey: false,
      },
      {
        name: 'other',
        type: 'INTEGER',
        primaryKey: false,
      },
    ],
  },
  another: {
    id: 2,
    schema: 'public',
    table: 'another',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        primaryKey: true,
      },
    ],
  },
}

import migrations from '../support/migrations/migrations.js'
import { ExecutionContext } from 'ava'
import { AuthState } from '../../src/auth'
import { OplogEntry } from '../../src/satellite/oplog'

// Speed up the intervals for testing.
export const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 40,
  pollingInterval: 200,
})

type Opts = SatelliteOpts & {
  minSnapshotWindow: number
  pollingInterval: number
}

export interface TestNotifier extends EventNotifier {
  notifications: any[]
}

export interface TestSatellite extends Satellite {
  _lastSentRowId: number
  _authState?: AuthState
  relations: RelationsCache

  _setAuthState(authState: AuthState): Promise<void>
  _performSnapshot(): Promise<Date>
  _getEntries(): Promise<OplogEntry[]>
  _apply(incoming: OplogEntry[], lsn?: LSN): Promise<void>
  _applyTransaction(transaction: DataTransaction): any
  _setMeta(key: string, value: SqlValue): Promise<void>
  _getMeta(key: string): Promise<string>
  _ack(lsn: number, isAck: boolean): Promise<void>
  _connectivityStateChange(status: ConnectivityState): void
  _getLocalRelations(): Promise<{ [k: string]: Relation }>
}

export type ContextType = {
  dbName: string
  adapter: DatabaseAdapter
  notifier: TestNotifier
  satellite: SatelliteProcess
  client: MockSatelliteClient
  runMigrations: () => Promise<void>
  tableInfo: TableInfo
  timestamp: number
  authState: AuthState
}

export const makeContext = async (
  t: ExecutionContext<ContextType>,
  options: Opts = opts
) => {
  await mkdir('.tmp', { recursive: true })
  const dbName = `.tmp/test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new BundleMigrator(adapter, migrations)
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const satellite = new SatelliteProcess(
    dbName,
    adapter,
    migrator,
    notifier,
    client,
    options
  )

  const tableInfo = initTableInfo()
  const timestamp = new Date().getTime()

  const runMigrations = async () => {
    await migrator.up()
  }

  const authState = { clientId: '', token: 'test-token' }

  t.context = {
    dbName,
    adapter,
    notifier,
    client,
    runMigrations,
    satellite,
    tableInfo,
    timestamp,
    authState,
  }
}

export const clean = async (t: ExecutionContext) => {
  const { dbName } = t.context as any

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })
}

export const cleanAndStopSatellite = async (t: ExecutionContext) => {
  await clean(t)
  const { satellite } = t.context as any
  await satellite.stop()
}
