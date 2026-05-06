export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
  tokenType: string
}

export async function exchangeClientCredentials(opts: {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: `client_credentials`,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    ...(opts.scopes ? { scope: opts.scopes.join(` `) } : {}),
  })
  const res = await f(opts.tokenUrl, {
    method: `POST`,
    body,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
  })
  if (!res.ok) {
    throw new Error(`token endpoint ${res.status}: ${await res.text()}`)
  }
  const j = (await res.json()) as {
    access_token: string
    expires_in?: number
    token_type?: string
    refresh_token?: string
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    tokenType: j.token_type ?? `Bearer`,
  }
}
