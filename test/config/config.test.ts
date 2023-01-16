import test from 'ava'

import { ElectricConfig, hydrateConfig } from '../../src/config/index'

import configModule from '../support/.electric/default/index'
const config: ElectricConfig = configModule

test('configure', async (t) => {
  t.is(config.app, 'tarragon-envy-5432')

  if (config.migrations) {
    t.true(config.migrations.length > 0)
  } else {
    t.fail('migrations field should be set')
  }
})

test('hydrate', async (t) => {
  t.is(config.replication, undefined)

  const hydrated = hydrateConfig(config)

  t.is(hydrated.replication, {
    host: 'default.tarragon-envy-5432.db.electric-sql.com',
    port: 443,
    ssl: true,
  })

  t.is(hydrated.console, {
    host: 'console.electric-sql.com',
  })

  t.false(hydrated.debug)
})
