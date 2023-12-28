import anyTest, { TestFn } from 'ava'
import { sleepAsync } from '../../src/util/timer'

import { satelliteDefaults } from '../../src/satellite/config'
import { makeContext, clean, ContextType } from './common'
import { AuthStatus } from '../../src/auth'

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 80,
  pollingInterval: 500,
})

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => makeContext(t, opts))
test.afterEach.always(clean)

test('throttled snapshot respects window', async (t) => {
  const { adapter, notifier, runMigrations, satellite, authState } = t.context
  await runMigrations()

  await satellite._setAuthState({
    ...authState,
    status: AuthStatus.AUTHENTICATED,
  })

  await satellite._throttledSnapshot()

  const numNotifications = notifier.notifications.length

  const sql = `INSERT INTO parent(id) VALUES ('1'),('2')`
  await adapter.run({ sql })
  await satellite._throttledSnapshot()

  t.is(notifier.notifications.length, numNotifications)

  await sleepAsync(opts.minSnapshotWindow)

  t.is(notifier.notifications.length, numNotifications + 1)
})
