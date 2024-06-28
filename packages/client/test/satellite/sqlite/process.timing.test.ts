import anyTest, { TestFn } from 'ava'
import { processTimingTests } from '../process.timing'
import { makeContext, cleanAndStopDb, ContextType } from '../common'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => makeContext(t, 'main'))
test.afterEach.always(cleanAndStopDb)

processTimingTests(test)
