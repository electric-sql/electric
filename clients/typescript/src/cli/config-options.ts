import path from 'path'
import {
  inferDbUrlPart,
  inferProxyUrlPart,
  inferServiceUrlPart,
  getConfigValue,
  type ConfigMap,
  AnyConfigOption,
} from './config'
import { dedent, getAppName, buildDatabaseURL, parsePgProxyPort } from './utils'
import { LIB_VERSION } from '../version'

const minorVersion = LIB_VERSION.split('.').slice(0, 2).join('.')


// Name will be prefixed with ELECDATABASE_REQUIRE_SSLTRIC_ as environment variables.
export const configOptions : Record<string, AnyConfigOption> = {
  // *** Client options ***
  SERVICE: {
    valueType: String,
    valueTypeName: 'url',
    doc: 'URL of the Electric service.',
    groups: ['client', 'tunnel'],
    shortForm: 's',
    defaultVal: (options: ConfigMap) => {
      const host = getConfigValue('SERVICE_HOST', options)
      const port = getConfigValue('HTTP_PORT', options)
      return `http://${host}:${port}`
    },
    constructedDefault: 'http://{ELECTRIC_SERVICE_HOST}:{ELECTRIC_HTTP_PORT}',
  },
  PROXY: {
    valueType: String,
    valueTypeName: 'url',
    doc: "URL of the Electric service's PostgreSQL proxy.",
    groups: ['client', 'proxy'],
    shortForm: 'p',
    defaultVal: (options: ConfigMap) => {
      const host = getConfigValue('PG_PROXY_HOST', options).toString()
      const port = parsePgProxyPort(
        parseInt(getConfigValue('PG_PROXY_PORT', options) + '')
      ).port
      const user = 'postgres'
      const password = getConfigValue('PG_PROXY_PASSWORD', options).toString()
      const dbName = getConfigValue('DATABASE_NAME', options).toString()
      const ssl = getConfigValue('DATABASE_REQUIRE_SSL', options) as boolean
      return buildDatabaseURL({ host, port, user, password, dbName, ssl })
    },
    constructedDefault:
      'postgresql://postgres:{ELECTRIC_PG_PROXY_PASSWORD}@{ELECTRIC_PG_PROXY_HOST}:{ELECTRIC_PG_PROXY_PORT}/{ELECTRIC_DATABASE_NAME}',
  },
  CLIENT_PATH: {
    valueType: String,
    valueTypeName: 'path',
    shortForm: 'o',
    doc: 'Path to the directory where the generated client code will be written.',
    groups: ['client'],
    defaultVal: path.join('.', 'src', 'generated', 'client'),
  },
  SERVICE_HOST: {
    valueType: String,
    valueTypeName: 'hostname',
    doc: 'Hostname the Electric service is running on.',
    groups: ['client', 'proxy'],
    inferVal: (options: ConfigMap) => inferServiceUrlPart('host', options),
    defaultVal: 'localhost',
  },
  PG_PROXY_HOST: {
    valueType: String,
    valueTypeName: 'hostname',
    doc: dedent`
      Hostname the Migration Proxy is running on. This is usually the same as, 
      and defaults to, SERVICE_HOST.

      If using the proxy-tunnel, this should be the hostname of the tunnel.
    `,
    groups: ['client', 'proxy'],
    inferVal: (options: ConfigMap) => inferProxyUrlPart('host', options),
    defaultVal: (options: ConfigMap) => getConfigValue('SERVICE_HOST', options).toString(),
  },
  MODULE_RESOLUTION: {
    valueType: String,
    valueTypeName: 'string',
    doc: dedent`
      The module resolution used for the project. The generated client will be 
      compatible with this resolution.
    `,
    groups: ['client'],
    defaultVal: 'node',
  },

  // *** Postgres database connection options ***
  WITH_POSTGRES: {
    doc: 'Start a PostgreSQL database along with Electric.',
    valueType: Boolean,
    defaultVal: false,
    groups: ['database', 'electric'],
  },
  DATABASE_URL: {
    doc: 'PostgreSQL connection URL for the database.',
    valueType: String,
    valueTypeName: 'url',
    shortForm: 'db',
    defaultVal: (options: ConfigMap) => {
      const host = getConfigValue('DATABASE_HOST', options).toString()
      const port = parseInt(getConfigValue('DATABASE_PORT', options) + '')
      const user = getConfigValue('DATABASE_USER', options).toString()
      const password = getConfigValue('DATABASE_PASSWORD', options).toString()
      const dbName = getConfigValue('DATABASE_NAME', options).toString()
      return buildDatabaseURL({ host, port, user, password, dbName })
    },
    constructedDefault:
      'postgresql://{ELECTRIC_DATABASE_USER}:{ELECTRIC_DATABASE_PASSWORD}@{ELECTRIC_DATABASE_HOST}:{ELECTRIC_DATABASE_PORT}/{ELECTRIC_DATABASE_NAME}',
    groups: ['database', 'electric'],
  },
  DATABASE_HOST: {
    doc: 'Hostname of the database server.',
    valueType: String,
    inferVal: (options: ConfigMap) => inferDbUrlPart('host', options),
    defaultVal: 'localhost',
    groups: ['database'],
  },
  DATABASE_PORT: {
    doc: 'Port number of the database server.',
    valueType: Number,
    inferVal: (options: ConfigMap) => inferDbUrlPart('port', options),
    defaultVal: 5432,
    groups: ['database'],
  },
  DATABASE_USER: {
    doc: 'Username to connect to the database with.',
    valueType: String,
    inferVal: (options: ConfigMap) => inferDbUrlPart('user', options),
    defaultVal: 'postgres',
    groups: ['database'],
  },
  DATABASE_PASSWORD: {
    doc: 'Password to connect to the database with.',
    valueType: String,
    inferVal: (options: ConfigMap) => inferDbUrlPart('password', options),
    defaultVal: 'db_password',
    groups: ['database'],
  },
  DATABASE_NAME: {
    doc: 'Name of the database to connect to.',
    valueType: String,
    inferVal: (options: ConfigMap) => inferDbUrlPart('dbName', options),
    defaultVal: () => getAppName() ?? 'electric',
    groups: ['database', 'client', 'proxy'],
  },

  // *** Electric options ***
  DATABASE_REQUIRE_SSL: {
    defaultVal: true,
    valueType: Boolean,
    doc: dedent`
      Set to false to enable Electric to fallback to using unencrypted connections
      in case the database is not configured to work with SSL.

      Be mindful of changing this default, more often than not it's a bad idea to
      use unencrypted database connections because all data flowing between your
      database and Electric may get intercepted by an unauthorized party.
    `,
    groups: ['electric'],
  },
  DATABASE_USE_IPV6: {
    defaultVal: true,
    valueType: Boolean,
    doc: dedent`
      Set to false to stop Electric from trying to connect to the database over IPv6.
      By default, it will try to resolve the hostname from DATABASE_URL to an
      IPv6 address, falling back to IPv4 in case that fails.
    `,
    groups: ['electric'],
  },
  ELECTRIC_USE_IPV6: {
    defaultVal: true,
    valueType: Boolean,
    doc: dedent`
      Set to false to force Electric to only listen on IPv4 interfaces.

      By default, Electric will accept inbound connections over both IPv6 and IPv4
      when running on Linux. On Windows and some BSD systems inbound connections
      over IPv4 will not be accepted unless this option is disabled.
    `,
    groups: ['electric'],
  },
  ELECTRIC_WRITE_TO_PG_MODE: {
    defaultVal: 'logical_replication',
    valueType: String,
    valueTypeName: 'logical_replication | direct_writes',
    doc: dedent`
      In logical_replication mode, Electric provides a logical replication publisher
      service over TCP that speaks the Logical Streaming Replication Protocol.
      Postgres connects to Electric and establishes a subscription to this.
      Writes are then streamed in and applied using logical replication.

      In direct_writes mode, Electric writes data to Postgres using a standard
      interactive client connection. This avoids the need for Postgres to be
      able to connect to Electric and reduces the permissions required for the
      database user that Electric connects to Postgres as.

      CAUTION: The mode you choose affects your networking config and
      database user permissions.
    `,
    groups: ['electric'],
  },
  LOGICAL_PUBLISHER_HOST: {
    valueType: String,
    valueTypeName: 'url',
    doc: dedent`
        Host of this electric instance for the reverse connection from Postgres.
        Required if ELECTRIC_WRITE_TO_PG_MODE is set to logical_replication.
    `,
    groups: ['electric'],
  },
  LOGICAL_PUBLISHER_PORT: {
    defaultVal: '5433',
    valueType: Number,
    valueTypeName: 'port',
    doc: 'Port number to use for reverse connections from Postgres.',
    groups: ['electric'],
  },
  HTTP_PORT: {
    inferVal: (options: ConfigMap) => inferServiceUrlPart('port', options),
    defaultVal: '5133',
    valueType: Number,
    valueTypeName: 'port',
    doc: dedent`
      Port for HTTP connections. Includes client websocket connections on /ws, and 
      other functions on /api.
    `,
    groups: ['electric', 'client'],
  },
  PG_PROXY_PORT: {
    inferVal: (options: ConfigMap) => inferProxyUrlPart('port', options)?.toString(),
    defaultVal: '65432',
    valueType: String,
    valueTypeName: 'port',
    doc: 'Port number for connections to the Postgres migration proxy.',
    groups: ['electric', 'client', 'proxy'],
  },
  PG_PROXY_PASSWORD: {
    inferVal: (options: ConfigMap) => inferProxyUrlPart('password', options),
    defaultVal: 'proxy_password',
    valueType: String,
    valueTypeName: 'password',
    doc: dedent`
      Password to use when connecting to the Postgres proxy via psql or any other 
      Postgres client.
    `,
    groups: ['electric', 'client', 'proxy'],
  },
  AUTH_MODE: {
    defaultVal: 'secure',
    valueType: String,
    valueTypeName: 'secure | insecure',
    doc: 'Authentication mode to use to authenticate clients.',
    groups: ['electric'],
  },
  AUTH_JWT_ALG: {
    valueType: String,
    valueTypeName: 'algorithm',
    doc: 'The algorithm to use for JWT verification.',
    groups: ['electric'],
  },
  AUTH_JWT_KEY: {
    valueType: String,
    valueTypeName: 'key',
    doc: 'The key to use for JWT verification',
    groups: ['electric'],
  },
  AUTH_JWT_NAMESPACE: {
    valueType: String,
    valueTypeName: 'namespace',
    doc: dedent`
      This is an optional setting that specifies the location inside the token of 
      custom claims that are specific to Electric.
    `,
    groups: ['electric'],
  },
  AUTH_JWT_ISS: {
    valueType: String,
    valueTypeName: 'iss',
    doc: dedent`
      This optional setting allows you to specificy the "issuer" that will be matched 
      against the iss claim extracted from auth tokens.
    `,
    groups: ['electric'],
  },
  AUTH_JWT_AUD: {
    valueType: String,
    valueTypeName: 'aud',
    doc: dedent`
      This optional setting allows you to specificy the "audience" that will be matched
      against the aud claim extracted from auth tokens.
    `,
    groups: ['electric'],
  },
  ELECTRIC_TELEMETRY: {
    valueType: String,
    defaultVal: 'enabled',
    valueTypeName: 'enabled | disabled',
    doc: 'Set to "disable" to disable sending telemetry data to Electric.',
    groups: ['electric'],
  },
  POSTGRESQL_IMAGE: {
    valueType: String,
    valueTypeName: 'image',
    defaultVal: 'postgres:14-alpine',
    doc: 'The Docker image to use for the PostgreSQL database.',
    groups: ['electric'],
  },
  ELECTRIC_IMAGE: {
    valueType: String,
    valueTypeName: 'image',
    defaultVal: `electricsql/electric:${minorVersion}`, // Latest minor version of this library
    doc: 'The Docker image to use for Electric.',
    groups: ['electric'],
  },
  CONTAINER_NAME: {
    valueType: String,
    valueTypeName: 'name',
    defaultVal: (): string => getAppName() ?? 'electric',
    doc: 'The name to use for the Docker container.',
    groups: ['electric'],
  },
} as const
