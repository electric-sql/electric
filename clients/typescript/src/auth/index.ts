export { insecureAuthToken } from './insecure.js'

export interface AuthState {
  clientId: string
  token: string
}

export interface AuthConfig {
  clientId?: string
  token: string
}

export interface TokenClaims {
  [key: string]: any
}
