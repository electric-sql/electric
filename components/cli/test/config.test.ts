import test from 'ava'
import { getConfigValue, redactConfigSecrets } from '../src/config'
import { configOptions } from '../src/config-options'

const origEnv = { ...process.env }
test.beforeEach(() => {
  // restore environment
  process.env = origEnv
})

test('getConfigValue respects boolean flag defaults', async (t) => {
  const flagWithTrueDefault = Object.keys(configOptions).find(
    (key) =>
      configOptions[key].valueType === Boolean &&
      configOptions[key].defaultVal === true
  )!
  const flagWithFalseDefault = Object.keys(configOptions).find(
    (key) =>
      configOptions[key].valueType === Boolean &&
      configOptions[key].defaultVal === false
  )!

  t.is(getConfigValue(flagWithTrueDefault), true)
  t.is(getConfigValue(flagWithFalseDefault), false)

  // ensure environment overrides default
  process.env[`ELECTRIC_${flagWithTrueDefault}`] = 'false'
  process.env[`ELECTRIC_${flagWithFalseDefault}`] = 'true'
  t.is(getConfigValue(flagWithTrueDefault), false)
  t.is(getConfigValue(flagWithFalseDefault), true)
})

test('getConfigValue can capture `ELECTRIC_` prefixed CLI opitons', async (t) => {
  const image = getConfigValue('ELECTRIC_IMAGE', { image: 'electric:test' })
  const writeToPgMode = getConfigValue('ELECTRIC_WRITE_TO_PG_MODE', {
    writeToPgMode: 'test',
  })

  t.is(image, 'electric:test')
  t.is(writeToPgMode, 'test')
})

test('redactConfigValue redacts value in all of the config', (t) => {
  const config = {
    ELECTRIC_IMAGE: 'electric:test',
    PROXY:
      'postgresql://postgres:proxy_password@localhost:65432/test?sslmode=disable',
    PG_PROXY_PASSWORD: 'proxy_password',
    ELECTRIC_WRITE_TO_PG_MODE: 'test',
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
