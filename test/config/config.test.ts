import test from 'ava'

import { configure } from '../../src/config/index'

import app from '../support/electric.json'
import migrations from '../support/migrations'

test('configure', async (t) => {
  const config = configure(app, migrations)

  t.is(config.app, 'tarragon-envy-5432')
  if (config.migrations) {
    t.true(config.migrations.length > 0)
  } else {
    t.fail('migrations field should be set')
  }
})

test('overrides', async (t) => {
  const config = configure(app, migrations, {
    app: 'badger-foo-1234',
  })

  t.is(config.app, 'badger-foo-1234')
})
