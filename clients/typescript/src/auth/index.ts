export interface AuthState {
  app: string
  env: string
  clientId: string
  token?: string
  refreshToken?: string
}
