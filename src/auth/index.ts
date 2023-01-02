import { ConsoleClient, TokenRequest, TokenResponse } from "../satellite"
import { ElectricConfig } from "../satellite/config"
import { fetch } from "cross-fetch"
import Log from 'loglevel'

export interface AuthState {
  app: string,
  env: string,
  clientId: string
  token?: string
  refreshToken?: string
}

export class ConsoleHttpClient implements ConsoleClient {

  config: ElectricConfig

  constructor(config: ElectricConfig) {
    this.config = config

    if (!!config.console?.host) {
      // we always set the default, if not set it's an error
      throw Error("config.console must be set")
    }
  }

  async token({ app, env, clientId }: TokenRequest): Promise<TokenResponse> {
    Log.info(`fetching token for ${app} ${env} ${clientId}`)
    const res = await fetch(`https://${this.config.console?.host}/api/v1/jwt/auth/login`, {
      body: JSON.stringify({ data: { app, env, username: clientId } }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    const response = await res.json()

    if (response.errors) {
      throw Error('unable to fetch token')
    }

    const { data: { token, refreshToken } } = response
    return { token, refreshToken }
  }
}