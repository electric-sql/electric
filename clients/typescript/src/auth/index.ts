export { insecureAuthToken } from './insecure'

export interface AuthState {
  clientId: string
  userId?: string
  token?: string
}

export interface AuthConfig {
  clientId?: string
}

export interface TokenClaims {
  [key: string]: any
}
