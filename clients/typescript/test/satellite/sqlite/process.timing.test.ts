import anyTest, { TestFn } from 'ava'
import { processTimingTests, opts } from '../process.timing.test'
import { makeContext, clean, ContextType } from '../common'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => makeContext(t, opts))
test.afterEach.always(clean)

processTimingTests(test)
