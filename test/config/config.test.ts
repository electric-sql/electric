import test from 'ava'

import { configure } from '../../src/config/index'

test('import config', async (t) => {
  const config = await configure('../support/electric.json', import.meta.url)

  t.is(config.app, 'tarragon-envy-5432')
  t.true(config.migrations.length > 0)
})
