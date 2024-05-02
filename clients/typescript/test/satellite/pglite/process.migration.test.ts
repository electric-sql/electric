import testAny, { TestFn } from 'ava'
import { cleanAndStopSatellite, makePgliteContext } from '../common'
import { getPgMatchingShadowEntries } from '../../support/satellite-helpers'
import { pgBuilder } from '../../../src/migrators/query-builder'
import {
  commonSetup,
  ContextType,
  processMigrationTests,
} from '../process.migration'

const test = testAny as TestFn<ContextType>

test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgliteContext(t, namespace)
  t.context.getMatchingShadowEntries = getPgMatchingShadowEntries
  t.context.builder = pgBuilder
  await commonSetup(t)
})
test.afterEach.always(cleanAndStopSatellite)

processMigrationTests(test)
