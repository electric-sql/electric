import anyTest, { TestFn } from 'ava'

import { makeContext, cleanAndStopSatellite } from '../common'

import { processTagsTests, ContextType } from '../process.tags.test'
import { getMatchingShadowEntries } from '../../support/satellite-helpers'

const test = anyTest as TestFn<ContextType>
test.beforeEach(async (t) => {
  const namespace = 'main'
  await makeContext(t, namespace)
  t.context.getMatchingShadowEntries = getMatchingShadowEntries
})
test.afterEach.always(cleanAndStopSatellite)

processTagsTests(test)
