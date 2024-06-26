import { AuthConfig } from '../auth'
import {
  ConnectionBackoffOptions as ConnectionBackOffOptions,
  satelliteDefaults,
} from '../satellite/config'

export interface ElectricConfig {
  /**
   * Optional authentication configuration.
   * If not provided, a client ID is generated.
   */
  auth?: AuthConfig
  /**
   * Optional URL string to connect to the Electric sync service.
   *
   * Should have the following format:
   * `protocol://<host>:<port>[?ssl=true]`
   *
   * If the protocol is `https` or `wss` then `ssl`
   * defaults to true. Otherwise it defaults to false.
   *
   * If port is not provided, defaults to 443 when
   * ssl is enabled or 80 when it isn't.
   *
   * Defaults to:
   * `http://localhost:5133`
   */
  url?: string
  /**
   * Timeout (in milliseconds) for RPC requests.
   * Needs to be large enough for the server to have time to deliver the full initial subscription data
   * when the client subscribes to a shape for the first time.
   */
  timeout?: number
  /**
   * Optional flag to activate debug mode
   * which produces more verbose output.
   * Defaults to `false`.
   */
  debug?: boolean
  /**
   * Optional backoff options for connecting with Electric
   */
  connectionBackOffOptions?: ConnectionBackOffOptions
  /**
   * Whether to check foreign keys when applying downstream (i.e. incoming) transactions to the local SQLite database.
   * Defaults to `disabled`, meaning that FKs are not checked.
   * When using Postgres, this option cannot be changed.
   */
  foreignKeyChecksDownstream?: ForeignKeyChecks
}

export enum ForeignKeyChecks {
  enabled = 'enabled',
  disabled = 'disabled',
  inherit = 'inherit',
}

export type ElectricConfigWithDialect = ElectricConfig & {
  /** defaults to SQLite */
  dialect?: 'SQLite' | 'Postgres'
}

export type HydratedConfig = {
  auth: AuthConfig
  replication: {
    host: string
    port: number
    ssl: boolean
    timeout: number
    dialect: 'SQLite' | 'Postgres'
  }
  debug: boolean
  connectionBackOffOptions: ConnectionBackOffOptions
  namespace: string
  fkChecks: ForeignKeyChecks
}

export type InternalElectricConfig = {
  auth: AuthConfig
  replication?: {
    host: string
    port: number
    ssl: boolean
    timeout: number
  }
  debug?: boolean
  connectionBackOffOptions?: ConnectionBackOffOptions
  fkChecks: ForeignKeyChecks
}

export const hydrateConfig = (
  config: ElectricConfigWithDialect
): HydratedConfig => {
  const auth = config.auth ?? {}

  const debug = config.debug ?? false
  const url = new URL(config.url ?? 'http://localhost:5133')

  const isSecureProtocol = url.protocol === 'https:' || url.protocol === 'wss:'
  const sslEnabled = isSecureProtocol || url.searchParams.get('ssl') === 'true'

  const defaultPort = sslEnabled ? 443 : 80
  const portInt = parseInt(url.port, 10)
  const port = Number.isNaN(portInt) ? defaultPort : portInt

  const defaultNamespace = config.dialect === 'Postgres' ? 'public' : 'main'

  const fkChecks =
    config.foreignKeyChecksDownstream ?? ForeignKeyChecks.disabled

  const replication = {
    host: url.hostname,
    port: port,
    ssl: sslEnabled,
    timeout: config.timeout ?? 3000,
    dialect: config.dialect ?? 'SQLite',
  }

  const {
    delayFirstAttempt,
    jitter,
    maxDelay,
    numOfAttempts,
    startingDelay,
    timeMultiple,
  } =
    config.connectionBackOffOptions ??
    satelliteDefaults(defaultNamespace).connectionBackOffOptions

  const connectionBackOffOptions = {
    delayFirstAttempt,
    jitter,
    maxDelay,
    numOfAttempts,
    startingDelay,
    timeMultiple,
  }

  return {
    auth,
    replication,
    debug,
    connectionBackOffOptions,
    namespace: defaultNamespace,
    fkChecks,
  }
}
