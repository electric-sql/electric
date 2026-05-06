import type { TokenSet } from './client-credentials'

export interface DeviceFlowStart {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  intervalSec: number
  expiresAt: Date
}

export async function startDeviceFlow(opts: {
  deviceAuthorizationUrl: string
  clientId: string
  scopes?: string[]
  fetch?: typeof globalThis.fetch
}): Promise<DeviceFlowStart> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    client_id: opts.clientId,
    ...(opts.scopes ? { scope: opts.scopes.join(` `) } : {}),
  })
  const res = await f(opts.deviceAuthorizationUrl, {
    method: `POST`,
    body,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
  })
  if (!res.ok) throw new Error(`device authorization failed: ${res.status}`)
  const j = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    interval?: number
    expires_in?: number
  }
  return {
    deviceCode: j.device_code,
    userCode: j.user_code,
    verificationUri: j.verification_uri,
    verificationUriComplete: j.verification_uri_complete,
    intervalSec: j.interval ?? 5,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 600) * 1000),
  }
}

export async function pollDeviceFlow(opts: {
  tokenUrl: string
  clientId: string
  deviceCode: string
  intervalSec: number
  expiresAt: Date
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  let interval = opts.intervalSec
  while (Date.now() < opts.expiresAt.getTime()) {
    if (interval > 0) await new Promise((r) => setTimeout(r, interval * 1000))
    const body = new URLSearchParams({
      grant_type: `urn:ietf:params:oauth:grant-type:device_code`,
      device_code: opts.deviceCode,
      client_id: opts.clientId,
    })
    const res = await f(opts.tokenUrl, {
      method: `POST`,
      body,
      headers: { 'Content-Type': `application/x-www-form-urlencoded` },
    })
    const j = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      error?: string
      error_description?: string
    }
    if (res.ok && j.access_token)
      return {
        accessToken: j.access_token,
        refreshToken: j.refresh_token,
        expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
        tokenType: j.token_type ?? `Bearer`,
      }
    if (j.error === `authorization_pending`) continue
    if (j.error === `slow_down`) {
      if (interval > 0) interval += 5
      continue
    }
    throw new Error(`device flow error: ${j.error_description ?? j.error}`)
  }
  throw new Error(`device flow timed out`)
}
