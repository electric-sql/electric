import anyTest, { TestFn } from 'ava'

import { getMatchingShadowEntries as getSQLiteMatchingShadowEntries } from '../../support/satellite-helpers'

import { makeContext, cleanAndStopSatellite } from '../common'

import { sqliteBuilder } from '../../../src/migrators/query-builder'
import { processTests, ContextType } from '../process.test'
import { QualifiedTablename } from '../../../src/util'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  const namespace = 'main'
  await makeContext(t, namespace)
  t.context.builder = sqliteBuilder
  t.context.getMatchingShadowEntries = getSQLiteMatchingShadowEntries
  t.context.qualifiedParentTableName = new QualifiedTablename(
    namespace,
    'parent'
  ).toString()
})
test.afterEach.always(cleanAndStopSatellite)

processTests(test)
