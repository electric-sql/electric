export { authToken } from './util'

export interface AuthState {
  clientId: string
  token: string
}

export interface AuthConfig {
  clientId?: string
  token: string
}
