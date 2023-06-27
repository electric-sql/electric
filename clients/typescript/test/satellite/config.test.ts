import test from 'ava'
import { hydrateConfig, ElectricConfig } from '../../src/config'

test('addDefaults adds expected defaults', async (t) => {
  const config: ElectricConfig = {
    migrations: [],
  }

  const configWithDefaults = hydrateConfig(config)

  t.deepEqual(configWithDefaults.migrations, [])

  t.is(configWithDefaults.replication.host, '127.0.0.1')
  t.is(configWithDefaults.replication.port, 5133)
  t.is(configWithDefaults.replication.ssl, false)

  t.pass()
})
