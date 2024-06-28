import testAny, { TestFn } from 'ava'
import { cleanAndStopSatellite, makePgContext } from '../common'
import { getPgMatchingShadowEntries } from '../../support/satellite-helpers'
import { pgBuilder } from '../../../src/migrators/query-builder'
import {
  commonSetup,
  ContextType,
  processMigrationTests,
} from '../process.migration'

const test = testAny as TestFn<ContextType>

let port = 5000
test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgContext(t, port++, namespace)
  t.context.getMatchingShadowEntries = getPgMatchingShadowEntries
  t.context.builder = pgBuilder
  await commonSetup(t)
})
test.afterEach.always(cleanAndStopSatellite)

processMigrationTests(test)
