import { AuthConfig } from '../auth/index'

export interface ElectricConfig {
  auth: AuthConfig
  /**
   * Optional path to the Electric sync service.
   * Should have the following format:
   * `electric://<host>:<port>`
   * Defaults to:
   * `electric://127.0.0.1:5133`
   */
  url?: string
  /**
   * Optional flag to activate debug mode
   * which produces more verbose output.
   * Defaults to `false`.
   */
  debug?: boolean
}

export type HydratedConfig = {
  auth: AuthConfig
  replication: {
    host: string
    port: number
    ssl: boolean
  }
  debug: boolean
}

export type InternalElectricConfig = {
  auth: AuthConfig
  replication?: {
    host: string
    port: number
    ssl: boolean
  }
  debug?: boolean
}

export const hydrateConfig = (config: ElectricConfig): HydratedConfig => {
  const auth = config.auth
  if (!auth || !auth.token) {
    throw new Error('Invalid configuration. Missing authentication token.')
  }

  const debug = config.debug ?? false

  const url = config.url ?? 'electric://127.0.0.1:5133'
  const matches = url.match(/(?:electric:\/\/)(.+):([0-9]*)/)
  if (matches === null) {
    throw new Error(
      "Invalid Electric URL. Must be of the form: 'electric://<host>:<port>'"
    )
  }
  const [_fullMatch, host, port] = matches
  const replication = {
    host,
    port: parseInt(port, 10),
    ssl: false,
  }

  return {
    auth,
    replication,
    debug,
  }
}
