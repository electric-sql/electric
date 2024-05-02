import anyTest, { TestFn } from 'ava'
import { processTimingTests } from '../process.timing'
import {
  makePgliteContext,
  cleanAndStopSatellite,
  ContextType,
} from '../common'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgliteContext(t, namespace)
})
test.afterEach.always(cleanAndStopSatellite)

processTimingTests(test)
