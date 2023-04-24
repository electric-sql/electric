import { mkdir, rm as removeFile } from 'node:fs/promises'

import test from 'ava'

import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'

import { MockSatelliteClient } from '../../src/satellite/mock'
import { BundleMigrator } from '../../src/migrators/bundle'
import { MockNotifier } from '../../src/notifiers/mock'
import { MockConsoleClient } from '../../src/auth/mock'
import { randomValue } from '../../src/util/random'
import { sleepAsync } from '../../src/util/timer'

import { SatelliteConfig, satelliteDefaults } from '../../src/satellite/config'
import { SatelliteProcess } from '../../src/satellite/process'

import { initTableInfo } from '../support/satellite-helpers'
import { Satellite } from '../../src/satellite'

import config from '../support/.electric/@config/index'
import {makeContext, stopSatellite} from "./common";
const { migrations } = config

type ContextType = {
  dbName: string
  adapter: DatabaseAdapter
  satellite: Satellite
  client: MockSatelliteClient
}

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 80,
  pollingInterval: 500,
})

test.beforeEach(async (t) => makeContext(t, opts))
test.afterEach.always(stopSatellite)

test('throttled snapshot respects window', async (t) => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._setAuthState()
  await satellite._throttledSnapshot()
  const numNotifications = notifier.notifications.length

  const sql = `INSERT INTO parent(id) VALUES ('1'),('2')`
  await adapter.run({ sql })
  await satellite._throttledSnapshot()

  t.is(notifier.notifications.length, numNotifications)

  await sleepAsync(opts.minSnapshotWindow)

  t.is(notifier.notifications.length, numNotifications + 1)
})
