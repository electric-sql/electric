export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number /* unix seconds */
  tokenType?: string
  scope?: string
}

export interface OAuthClientInfo {
  clientId: string
  clientSecret?: string
  redirectUris?: string[]
  registeredAt?: number /* unix seconds */
}

export interface CredentialStore {
  getApiKey?(server: string): string | undefined | Promise<string | undefined>
  getClientCredentials?(
    server: string
  ):
    | { clientId: string; clientSecret: string }
    | undefined
    | Promise<{ clientId: string; clientSecret: string } | undefined>
  getOAuthTokens?(
    server: string
  ): OAuthTokens | undefined | Promise<OAuthTokens | undefined>
  saveOAuthTokens?(server: string, tokens: OAuthTokens): void | Promise<void>
  getOAuthClientInfo?(
    server: string
  ): OAuthClientInfo | undefined | Promise<OAuthClientInfo | undefined>
  saveOAuthClientInfo?(
    server: string,
    info: OAuthClientInfo
  ): void | Promise<void>
}
