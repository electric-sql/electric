import test from 'ava'
import { sleepAsync } from '../../src/util/timer'

import { satelliteDefaults } from '../../src/satellite/config'
import {makeContext, stopSatellite} from "./common";

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
