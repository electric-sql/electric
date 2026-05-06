import { randomBytes } from 'node:crypto'
import { generatePkcePair } from './pkce'
import type { TokenSet } from './client-credentials'

export interface AuthRequest {
  url: string
  state: string
  verifier: string
}

interface TokenResponse {
  access_token: string
  expires_in?: number
  token_type?: string
  refresh_token?: string
}

export function buildAuthorizationUrl(opts: {
  authorizationUrl: string
  clientId: string
  redirectUri: string
  scopes?: string[]
  resource?: string
}): AuthRequest {
  const { verifier, challenge } = generatePkcePair()
  const state = randomBytes(16).toString(`hex`)
  const u = new URL(opts.authorizationUrl)
  u.searchParams.set(`response_type`, `code`)
  u.searchParams.set(`client_id`, opts.clientId)
  u.searchParams.set(`redirect_uri`, opts.redirectUri)
  u.searchParams.set(`state`, state)
  u.searchParams.set(`code_challenge`, challenge)
  u.searchParams.set(`code_challenge_method`, `S256`)
  if (opts.scopes?.length) u.searchParams.set(`scope`, opts.scopes.join(` `))
  if (opts.resource) u.searchParams.set(`resource`, opts.resource)
  return { url: u.toString(), state, verifier }
}

export async function exchangeAuthorizationCode(opts: {
  tokenUrl: string
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: `authorization_code`,
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code: opts.code,
    code_verifier: opts.verifier,
  })
  const res = await f(opts.tokenUrl, {
    method: `POST`,
    body,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
  })
  if (!res.ok) {
    throw new Error(`token endpoint ${res.status}: ${await res.text()}`)
  }
  const j = (await res.json()) as TokenResponse
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    tokenType: j.token_type ?? `Bearer`,
  }
}

export async function refreshToken(opts: {
  tokenUrl: string
  clientId: string
  refreshToken: string
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: `refresh_token`,
    client_id: opts.clientId,
    refresh_token: opts.refreshToken,
  })
  const res = await f(opts.tokenUrl, {
    method: `POST`,
    body,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
  })
  if (!res.ok) {
    throw new Error(`refresh failed: ${res.status}`)
  }
  const j = (await res.json()) as TokenResponse
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    tokenType: j.token_type ?? `Bearer`,
  }
}
