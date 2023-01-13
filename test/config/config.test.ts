import test from 'ava'

import { configure } from '../../src/config/index'

test('import config', async (t) => {
  const config = await configure('../support/electric.json', import.meta.url)

  t.is(config.app, 'tarragon-envy-5432')
  if (config.migrations) {
    t.true(config.migrations.length > 0)
  } else {
    t.fail('migrations field should be set')
  }
})
