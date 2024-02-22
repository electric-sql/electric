import anyTest, { TestFn } from 'ava'

import { getMatchingShadowEntries as getSQLiteMatchingShadowEntries } from '../../support/satellite-helpers'

import { makeContext, cleanAndStopSatellite } from '../common'

import { sqliteBuilder } from '../../../src/migrators/query-builder'
import { processTests, ContextType } from '../process.test'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  await makeContext(t)
  t.context.builder = sqliteBuilder
  t.context.getMatchingShadowEntries = getSQLiteMatchingShadowEntries
})
test.afterEach.always(cleanAndStopSatellite)

processTests(test)
