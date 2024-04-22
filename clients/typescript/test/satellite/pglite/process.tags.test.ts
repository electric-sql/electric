import anyTest, { TestFn } from 'ava'

import { makePgliteContext, cleanAndStopSatellite } from '../common'

import { getPgMatchingShadowEntries } from '../../support/satellite-helpers'
import { processTagsTests, ContextType } from '../process.tags.test'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  const namespace = 'public'
  await makePgliteContext(t, namespace)
  t.context.getMatchingShadowEntries = getPgMatchingShadowEntries
})
test.afterEach.always(cleanAndStopSatellite)

processTagsTests(test)
