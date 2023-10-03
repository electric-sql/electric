import { IBackOffOptions } from 'exponential-backoff'
import { AuthConfig } from '../auth/index'
import { satelliteDefaults } from '../satellite/config'

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
   * `http://127.0.0.1:5133`
   */
  url?: string
  /**
   * Optional flag to activate debug mode
   * which produces more verbose output.
   * Defaults to `false`.
   */
  debug?: boolean
  /**
   * Optional backoff options for connecting with Electric
   */
  backoffOpts?: Omit<IBackOffOptions, 'retry'>
}

export type HydratedConfig = {
  auth: AuthConfig
  replication: {
    host: string
    port: number
    ssl: boolean
  }
  debug: boolean
  backoffOpts: Omit<IBackOffOptions, 'retry'>
}

export type InternalElectricConfig = {
  auth: AuthConfig
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  debug?: boolean
  backoffOpts?: Omit<IBackOffOptions, 'retry'>
}

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const auth = config.auth
  if (!auth || !auth.token) {
    throw new Error('Invalid configuration. Missing authentication token.')
  }

  const debug = config.debug ?? false
  const url = new URL(config.url ?? 'http://127.0.0.1:5133')

  const isSecureProtocol = url.protocol === 'https:' || url.protocol === 'wss:'
  const sslEnabled = isSecureProtocol || url.searchParams.get('ssl') === 'true'

  const defaultPort = sslEnabled ? 443 : 80
  const portInt = parseInt(url.port, 10)
  const port = Number.isNaN(portInt) ? defaultPort : portInt

  const replication = {
    host: url.hostname,
    port: port,
    ssl: sslEnabled,
  }

  const backoffOpts = config.backoffOpts || satelliteDefaults.backoffOpts

  return {
    auth,
    replication,
    debug,
    backoffOpts,
  }
}
