import anyTest, { TestFn } from 'ava'
import { processTimingTests } from '../process.timing'
import { makeContext, clean, ContextType } from '../common'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => makeContext(t, 'main'))
test.afterEach.always(clean)

processTimingTests(test)
