import test from 'ava'
import { getConfigValue, redactConfigSecrets } from '../../src/cli/config'

test('getConfigValue can capture `ELECTRIC_` prefixed CLI opitons', async (t) => {
  const image = getConfigValue('ELECTRIC_IMAGE', { image: 'electric:test' })

  t.is(image, 'electric:test')
})

test('redactConfigValue redacts value in all of the config', (t) => {
  const config = {
    ELECTRIC_IMAGE: 'electric:test',
    PROXY:
      'postgresql://postgres:proxy_password@localhost:65432/test?sslmode=disable',
    PG_PROXY_PASSWORD: 'proxy_password',
    DATABASE_URL: 'postgresql://postgres:db_password@postgres:5432/test',
    DATABASE_PASSWORD: 'db_password',
    RANDOM_KEY_NOT_IN_CONFIG: 'foo',
  }
  t.deepEqual(redactConfigSecrets(config), {
    ...config,

    DATABASE_URL: 'postgresql://postgres:******@postgres:5432/test',
    DATABASE_PASSWORD: '******',
    PROXY: 'postgresql://postgres:******@localhost:65432/test?sslmode=disable',
    PG_PROXY_PASSWORD: '******',

    // should still include value outside of the config
    RANDOM_KEY_NOT_IN_CONFIG: 'foo',
  })
})
