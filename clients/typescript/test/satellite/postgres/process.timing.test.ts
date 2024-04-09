import anyTest, { TestFn } from 'ava'
import { processTimingTests } from '../process.timing.test'
import { makePgContext, cleanAndStopSatellite, ContextType } from '../common'

let port = 4900

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgContext(t, port++, namespace)
})
test.afterEach.always(cleanAndStopSatellite)

processTimingTests(test)
