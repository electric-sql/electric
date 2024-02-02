import test from 'ava'
import { configOptions } from '../../src/cli/config-options'


const expectedEnvVars = [
  'SERVICE',
  'PROXY',
  'CLIENT_PATH',
  'SERVICE_HOST',
  'PG_PROXY_HOST',
  'MODULE_RESOLUTION',
  'WITH_POSTGRES',
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
  'DATABASE_REQUIRE_SSL',
  'DATABASE_USE_IPV6',
  'ELECTRIC_USE_IPV6',
  'LOGICAL_PUBLISHER_HOST',
  'LOGICAL_PUBLISHER_PORT',
  'HTTP_PORT',
  'PG_PROXY_PORT',
  'PG_PROXY_PASSWORD',
  'ELECTRIC_WRITE_TO_PG_MODE',
  'AUTH_MODE',
  'AUTH_JWT_ALG',
  'AUTH_JWT_KEY',
  'AUTH_JWT_NAMESPACE',
  'AUTH_JWT_ISS',
  'AUTH_JWT_AUD',
  'ELECTRIC_TELEMETRY',
  'POSTGRESQL_IMAGE',
  'ELECTRIC_IMAGE',
  'CONTAINER_NAME',
]


test('assert that all expected env vars are options for CLI', (t) => {
  for (const i in expectedEnvVars) {
    t.not(
      configOptions[expectedEnvVars[i]],
      undefined,
      `Environment variable ${expectedEnvVars[i]} is missing from CLI`
    )
  }
})