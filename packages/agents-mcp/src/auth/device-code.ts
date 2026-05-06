import type { OAuthTokens as SdkTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface StartDeviceFlowOpts {
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
  scopes?: string[]
  resource?: string
  fetchImpl?: typeof fetch
}

export interface DeviceFlowHandle {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: number
  interval: number
  poll(opts?: { intervalMs?: number }): Promise<SdkTokens>
  cancel(): void
}

export async function startDeviceFlow(
  opts: StartDeviceFlowOpts
): Promise<DeviceFlowHandle> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const body = new URLSearchParams({ client_id: opts.clientId })
  if (opts.scopes?.length) body.set(`scope`, opts.scopes.join(` `))
  if (opts.resource) body.set(`resource`, opts.resource)

  const res = await fetchImpl(opts.deviceAuthorizationEndpoint, {
    method: `POST`,
    headers: { 'Content-Type': `application/x-www-form-urlencoded` },
    body,
  })
  if (!res.ok) throw new Error(`device_authorization endpoint ${res.status}`)
  const json = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }

  const expiresAt = Math.floor(Date.now() / 1000) + json.expires_in
  let cancelled = false

  const poll = async (
    pollOpts: { intervalMs?: number } = {}
  ): Promise<SdkTokens> => {
    const intervalMs = pollOpts.intervalMs ?? (json.interval ?? 5) * 1000
    while (!cancelled) {
      if (Math.floor(Date.now() / 1000) > expiresAt) {
        throw new Error(`expired_token`)
      }
      const tokenBody = new URLSearchParams({
        grant_type: `urn:ietf:params:oauth:grant-type:device_code`,
        device_code: json.device_code,
        client_id: opts.clientId,
      })
      if (opts.clientSecret) tokenBody.set(`client_secret`, opts.clientSecret)
      const tr = await fetchImpl(opts.tokenEndpoint, {
        method: `POST`,
        headers: { 'Content-Type': `application/x-www-form-urlencoded` },
        body: tokenBody,
      })
      const result = (await tr.json()) as {
        error?: string
        access_token?: string
        expires_in?: number
        refresh_token?: string
        token_type?: string
      }
      if (result.access_token) return result as SdkTokens
      if (
        result.error === `authorization_pending` ||
        result.error === `slow_down`
      ) {
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      throw new Error(result.error ?? `device flow failed`)
    }
    throw new Error(`cancelled`)
  }

  return {
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresAt,
    interval: json.interval ?? 5,
    poll,
    cancel() {
      cancelled = true
    },
  }
}
