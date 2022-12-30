import { ConsoleClient, TokenRequest, TokenResponse } from "../satellite"
import { baseDomain } from "../satellite/config"
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

  async token({ app, env, clientId }: TokenRequest): Promise<TokenResponse> {
    Log.info(`fetching token for ${app} ${env} ${clientId}`)
    const res = await fetch(`https://console.${baseDomain}/api/v1/jwt/auth/login`, {
      body: JSON.stringify({ data: { app, env, username: clientId } }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    })

    const { data: { token, refreshToken } } = await res.json()
    return { token, refreshToken }
  }
}