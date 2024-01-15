import { AuthConfig } from '../auth/index'
import {
  ConnectionBackoffOptions as ConnectionBackOffOptions,
  satelliteDefaults,
} from '../satellite/config'

export interface ElectricConfig {
  auth: AuthConfig
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
}

export type HydratedConfig = {
  auth: AuthConfig
  replication: {
    host: string
    port: number
    ssl: boolean
    timeout: number
  }
  debug: boolean
  connectionBackOffOptions: ConnectionBackOffOptions
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
}

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const auth = config.auth
  if (!auth || !auth.token) {
    throw new Error('Invalid configuration. Missing authentication token.')
  }

  const debug = config.debug ?? false
  const parsedServiceUrl = parseServiceUrl(config.url)

  const replication = {
    host: parsedServiceUrl.hostname,
    port: parsedServiceUrl.port,
    ssl: parsedServiceUrl.ssl,
    timeout: config.timeout ?? 3000,
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
    satelliteDefaults.connectionBackOffOptions

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
  }
}

function parseServiceUrl(inputUrl?: string): {
  hostname: string
  port: number
  ssl: boolean
} {
  let url: URL
  try {
    url = new URL(inputUrl ?? 'http://localhost:5133')
  } catch (e) {
    throwInvalidServiceUrlError()
  }

  const validProtocols = ['http:', 'https:', 'ws:', 'wss:', 'electric:']

  if (!validProtocols.includes(url.protocol)) {
    throwInvalidServiceUrlError('Invalid url protocol.')
  }

  if (url.username || url.password) {
    throwInvalidServiceUrlError('Username and password are not supported.')
  }

  const isSecureProtocol = url.protocol === 'https:' || url.protocol === 'wss:'
  const sslEnabled = isSecureProtocol || url.searchParams.get('ssl') === 'true'

  const defaultPort = sslEnabled ? 443 : 80
  const portInt = parseInt(url.port, 10)
  const port = Number.isNaN(portInt) ? defaultPort : portInt

  return { hostname: url.hostname, port, ssl: sslEnabled }
}

function throwInvalidServiceUrlError(reason?: string): never {
  let msg = "Invalid 'url' in the configuration."
  if (reason) {
    msg += ` ${reason}`
  }
  throw new Error(msg)
}
