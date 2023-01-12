import test from 'ava'
import { URL } from 'url' // in Browser, the URL in native accessible on window

import { electricConfig } from '../../src/config/index'

test('import config', async (t) => {
  const config = await electricConfig(
    '../support/electric.json',
    import.meta.url
  )

  t.is(config.app, 'tarragon-envy-5432')
  t.true(config.migrations.length > 0)
})
