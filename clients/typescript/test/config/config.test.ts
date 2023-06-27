import test from 'ava'

import { ElectricConfig, hydrateConfig } from '../../src/config/index'

import configModule from '../support/.electric/@config/index'
const config: ElectricConfig = configModule

test('configure', async (t) => {
  if (config.migrations) {
    t.true(config.migrations.length > 0)
  } else {
    t.fail('migrations field should be set')
  }
})

test('hydrate', async (t) => {
  t.is(config.replication, undefined)

  const hydrated = hydrateConfig(config)

  t.deepEqual(hydrated.replication, {
    host: '127.0.0.1',
    port: 5133,
    ssl: false,
  })

  t.false(hydrated.debug)
})
