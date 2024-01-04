import path from 'path'
import { defaultDbUrlPart, getConfigValue } from './config'
import { dedent, getAppName, buildDatabaseURL } from './utils'
import { LIB_VERSION } from '../version'

const minorVersion = LIB_VERSION.split('.').slice(0, 2).join('.')

// Name will be prefixed with ELECTRIC_ as environment variables.
export const configOptions = {
  // *** Client options ***
  SERVICE: {
    valueType: String,
    valueTypeName: 'url',
    doc: 'URL of the Electric service.',
    groups: ['client', 'tunnel'],
    shortForm: 's',
    defaultVal: () => {
      const host = getConfigValue('SERVICE_HOST')
      const port = getConfigValue('HTTP_PORT')
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
    defaultVal: () => {
      const host = getConfigValue('SERVICE_HOST')
      const port = getConfigValue('PG_PROXY_PORT')
      const password = getConfigValue('PG_PROXY_PASSWORD')
      const dbName = getConfigValue('DATABASE_NAME')
      return `postgresql://postgres:${password}@${host}:${port}/${dbName}`
    },
    constructedDefault:
      'postgresql://postgres:{ELECTRIC_PG_PROXY_PASSWORD}@{ELECTRIC_SERVICE_HOST}:{ELECTRIC_PG_PROXY_PORT}/{ELECTRIC_DATABASE_NAME}',
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
    defaultVal: 'localhost',
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
    defaultVal: () => {
      const host = getConfigValue('DATABASE_HOST')
      const port = getConfigValue('DATABASE_PORT')
      const user = getConfigValue('DATABASE_USER')
      const password = getConfigValue('DATABASE_PASSWORD')
      const dbName = getConfigValue('DATABASE_NAME')
      return buildDatabaseURL({ host, port, user, password, dbName })
    },
    constructedDefault:
      'postgresql://{ELECTRIC_DATABASE_USER}:{ELECTRIC_DATABASE_PASSWORD}@{ELECTRIC_DATABASE_HOST}:{ELECTRIC_DATABASE_PORT}/{ELECTRIC_DATABASE_NAME}',
    groups: ['database', 'electric'],
  },
  DATABASE_HOST: {
    doc: 'Hostname of the database server.',
    valueType: String,
    defaultVal: () => defaultDbUrlPart('host', 'localhost'),
    groups: ['database'],
  },
  DATABASE_PORT: {
    doc: 'Port number of the database server.',
    valueType: Number,
    defaultVal: () => defaultDbUrlPart('port', 5432),
    groups: ['database'],
  },
  DATABASE_USER: {
    doc: 'Username to connect to the database with.',
    valueType: String,
    defaultVal: () => defaultDbUrlPart('user', 'postgres'),
    groups: ['database'],
  },
  DATABASE_PASSWORD: {
    doc: 'Password to connect to the database with.',
    valueType: String,
    defaultVal: () => defaultDbUrlPart('password', 'db_password'),
    groups: ['database'],
  },
  DATABASE_NAME: {
    doc: 'Name of the database to connect to.',
    valueType: String,
    defaultVal: () => defaultDbUrlPart('dbName', getAppName() ?? 'electric'),
    groups: ['database', 'client', 'proxy'],
  },

  // *** Electric options ***
  DATABASE_REQUIRE_SSL: {
    defaultVal: false,
    valueType: Boolean,
    doc: 'Require SSL for the connection to the database.',
    groups: ['electric'],
  },
  DATABASE_USE_IPV6: {
    defaultVal: false,
    valueType: Boolean,
    doc: dedent`
      Set if your database is only accessible over IPv6. This is the case with 
      Fly Postgres, for example.
    `,
    groups: ['electric'],
  },
  ELECTRIC_USE_IPV6: {
    defaultVal: false,
    valueType: Boolean,
    doc: dedent`
      Make Electric listen on :: instead of 0.0.0.0. On Linux this allows inbound 
      connections over both IPv6 and IPv4. On Windows and some BSD systems inbound 
      connections will only be accepted over IPv6 when this setting is enabled.
    `,
    groups: ['electric'],
  },
  LOGICAL_PUBLISHER_HOST: {
    valueType: String,
    valueTypeName: 'url',
    doc: 'Host of this electric instance for the reverse connection from Postgres.',
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
    defaultVal: '65432',
    valueType: Number,
    valueTypeName: 'port',
    doc: 'Port number for connections to the Postgres migration proxy.',
    groups: ['electric', 'client', 'proxy'],
  },
  PG_PROXY_PASSWORD: {
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
    defaultVal: 'insecure',
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
} as const
