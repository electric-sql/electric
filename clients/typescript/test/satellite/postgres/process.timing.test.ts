import anyTest, { TestFn } from 'ava'
import { processTimingTests, opts } from '../process.timing.test'
import { makePgContext, cleanAndStopSatellite, ContextType } from '../common'

let port = 4900

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  await makePgContext(t, port++, opts)
})
test.afterEach.always(cleanAndStopSatellite)

processTimingTests(test)
