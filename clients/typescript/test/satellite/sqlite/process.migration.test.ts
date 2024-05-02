import testAny, { TestFn } from 'ava'
import { cleanAndStopSatellite, makeContext } from '../common'
import { getMatchingShadowEntries as getSQLiteMatchingShadowEntries } from '../../support/satellite-helpers'
import { sqliteBuilder } from '../../../src/migrators/query-builder'
import {
  ContextType,
  commonSetup,
  processMigrationTests,
} from '../process.migration'

const test = testAny as TestFn<ContextType>

test.beforeEach(async (t) => {
  const namespace = 'main'
  await makeContext(t, namespace)
  t.context.getMatchingShadowEntries = getSQLiteMatchingShadowEntries
  t.context.builder = sqliteBuilder
  await commonSetup(t)
})
test.afterEach.always(cleanAndStopSatellite)

processMigrationTests(test)
