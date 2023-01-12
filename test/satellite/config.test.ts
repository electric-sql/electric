import test from 'ava'
import { hydrateConfig, ElectricConfig } from '../../src/config'

test('addDefaults adds expected defaults', async (t) => {
  const config: ElectricConfig = {
    app: 'app',
  }

  const configWithDefaults = hydrateConfig(config)

  t.is(configWithDefaults.env, 'default')
  t.deepEqual(configWithDefaults.migrations, [])

  t.is(configWithDefaults.replication.host, 'default.app.db.electric-sql.com')
  t.is(configWithDefaults.replication.port, 443)
  t.is(configWithDefaults.replication.ssl, true)

  t.is(configWithDefaults.console.host, `console.electric-sql.com`)

  t.pass()
})
