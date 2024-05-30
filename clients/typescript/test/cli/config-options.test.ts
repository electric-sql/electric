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
    t.true(
      configOptions[expectedEnvVars[i]] !== undefined,
      `Environment variable ${expectedEnvVars[i]} is missing from CLI`
    )
  }

  t.deepEqual(
    Object.keys(configOptions).length,
    expectedEnvVars.length,
    'CLI options do not match expected environment variables'
  )
})

test('assert Electric is in logical_replication mode by default', (t) => {
  t.is(
    configOptions['ELECTRIC_WRITE_TO_PG_MODE'].defaultVal,
    'logical_replication'
  )
})

test('assert IPv6 is enabled by default', (t) => {
  t.is(configOptions['DATABASE_USE_IPV6'].defaultVal, true)
  t.is(configOptions['ELECTRIC_USE_IPV6'].defaultVal, true)
})

test('assert SSL is disabled by default', (t) => {
  t.is(configOptions['DATABASE_REQUIRE_SSL'].defaultVal, false)
})

test('assert authentication mode is insecure by default', (t) => {
  t.is(configOptions['AUTH_MODE'].defaultVal, 'insecure')
})

test('assert database name is correctly inferred', (t) => {
  // infer from db url
  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      databaseUrl: 'postgres://db_user:db_password@db_host:123/db_name',
    }),
    'db_name'
  )

  // infer from proxy url if db url missing
  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      proxy: 'postgres://db_user:db_password@db_host:123/db_name',
    }),
    'db_name'
  )

  // prefer db over proxy for name
  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      databaseUrl: 'postgres://db_user:db_password@db_host:123/db_name',
      proxy: 'postgres://db_user:db_password@db_host:123/proxy_db_name',
    }),
    'db_name'
  )

  // ignores query parameters in the URL
  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      databaseUrl:
        'postgres://db_user:db_password@db_host:123/db_name?sslmode=disable',
    }),
    'db_name'
  )

  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      proxy:
        'postgres://db_user:db_password@db_host:123/db_name?sslmode=require',
    }),
    'db_name'
  )

  // correctly decodes encoded characters
  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      databaseUrl: 'postgres://db_user:db_password@db_host:123/odd%3Adb%2Fname',
    }),
    'odd:db/name'
  )

  t.is(
    configOptions['DATABASE_NAME'].inferVal({
      proxy: 'postgres://db_user:db_password@db_host:123/odd%3Adb%2Fname',
    }),
    'odd:db/name'
  )
})

test('assert DATABASE_URL may contain percent-encoded characters', (t) => {
  const dbUrl =
    'postgresql://test%2Bemail%40example.com:12%2B34@example.%63om/odd%3Adb%2Fname'

  t.is(
    configOptions['DATABASE_HOST'].inferVal({ databaseUrl: dbUrl }),
    'example.com'
  )
  t.is(
    configOptions['DATABASE_USER'].inferVal({ databaseUrl: dbUrl }),
    'test+email@example.com'
  )
  t.is(
    configOptions['DATABASE_PASSWORD'].inferVal({ databaseUrl: dbUrl }),
    '12+34'
  )
})

test('assert DATABASE_PORT is inferred to the default value when not present in the URL', (t) => {
  const dbUrl = 'postgresql://user:@example.com/db'

  t.is(configOptions['DATABASE_PORT'].inferVal({ databaseUrl: dbUrl }), 5432)
  t.is(configOptions['DATABASE_PORT'].inferVal({ proxy: dbUrl }), 5432)
})

test('assert PG_PROXY_PORT is inferred to the default value when not present in the URL', (t) => {
  const proxyUrl = 'postgresql://user:@example.com/db'
  t.is(configOptions['PG_PROXY_PORT'].inferVal({ proxy: proxyUrl }), '65432')
})
