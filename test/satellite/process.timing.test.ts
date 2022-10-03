import { readFile, rm as removeFile } from 'node:fs/promises'

import test from 'ava'

import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'

import { MockSatelliteClient } from '../../src/satellite/mock'
import { BundleMigrator } from '../../src/migrators/bundle'
import { MockNotifier } from '../../src/notifiers/mock'
import { randomValue } from '../../src/util/random'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'

import { satelliteDefaults } from '../../src/satellite/config'
import { SatelliteProcess } from '../../src/satellite/process'

import { initTableInfo } from '../support/satellite-helpers'
import { Satellite } from '../../src/satellite'

type ContextType = {
  adapter: DatabaseAdapter,
  satellite: Satellite,
  client: MockSatelliteClient
}

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 80,
  pollingInterval: 500
})

test.beforeEach(t => {
  const dbName = `test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new BundleMigrator(adapter, '../../test/support/migrations')
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const satellite = new SatelliteProcess(dbName, adapter, migrator, notifier, client, opts)

  const tableInfo = initTableInfo()
  const timestamp = new Date().getTime()

  const runMigrations = async () => {
    await migrator.up()
  }

  t.context = {
    dbName,
    db,
    adapter,
    migrator,
    notifier,
    client,
    runMigrations,
    satellite,
    tableInfo,
    timestamp
  }
})

test.afterEach.always(async t => {
  const { dbName } = t.context as any

  await removeFile(dbName, {force: true})
  await removeFile(`${dbName}-journal`, {force: true})
})

test('throttled snapshot respects window', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._throttledSnapshot()
  const numNotifications = notifier.notifications.length

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)
  await satellite._throttledSnapshot()

  t.is(notifier.notifications.length, numNotifications)

  await sleepAsync(opts.minSnapshotWindow)

  t.is(notifier.notifications.length, numNotifications + 1)
})


