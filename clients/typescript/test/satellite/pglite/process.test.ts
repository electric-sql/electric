import anyTest, { TestFn } from 'ava'

import { getPgMatchingShadowEntries } from '../../support/satellite-helpers'

import { makePgliteContext, cleanAndStopSatellite } from '../common'

import { pgBuilder } from '../../../src/migrators/query-builder'
import { processTests, ContextType } from '../process.test'
import { QualifiedTablename } from '../../../src/util'

// Run all tests in this file serially
// because there are a lot of tests
// and it would lead to PG running out of shared memory
const test = anyTest.serial as TestFn<ContextType>
test.serial = test // because the common test file uses `test.serial` for some tests (but for PG all tests are serial)
test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgliteContext(t, namespace)
  t.context.builder = pgBuilder
  t.context.getMatchingShadowEntries = getPgMatchingShadowEntries
  t.context.qualifiedParentTableName = new QualifiedTablename(
    namespace,
    'parent'
  ).toString()
})
test.afterEach.always(cleanAndStopSatellite)

processTests(test)
