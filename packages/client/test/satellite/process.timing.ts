import { TestFn } from 'ava'
import { sleepAsync } from '../../src/util/timer'

import { ContextType } from './common'
import { satelliteDefaults } from '../../src/satellite/config'

/*
 * This file defines the tests for the process timing of Satellite.
 * These tests are common to both SQLite and Postgres.
 * Only their context differs.
 * Therefore, the SQLite and Postgres test files
 * setup their context and then call the tests from this file.
 */

// Speed up the intervals for testing.
export const opts = (namespace: string) =>
  Object.assign({}, satelliteDefaults(namespace), {
    minSnapshotWindow: 80,
    pollingInterval: 500,
  })

export const processTimingTests = (test: TestFn<ContextType>) => {
  test(`throttled snapshot respects window`, async (t) => {
    const {
      adapter,
      notifier,
      runMigrations,
      satellite,
      authState,
      namespace,
    } = t.context
    await runMigrations()

    await satellite._setAuthState(authState)

    await satellite._throttledSnapshot()

    const numNotifications = notifier.notifications.length

    const sql = `INSERT INTO parent(id) VALUES ('1'),('2')`
    await adapter.run({ sql })
    await satellite._throttledSnapshot()

    t.is(notifier.notifications.length, numNotifications)

    await sleepAsync(opts(namespace).minSnapshotWindow + 50)

    t.is(notifier.notifications.length, numNotifications + 1)
  })
}
