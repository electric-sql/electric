export interface AuthServerMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
  deviceAuthorizationEndpoint?: string
  registrationEndpoint?: string
  scopesSupported?: Array<string>
}

export async function discoverAuthServer(
  resourceUrl: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<AuthServerMetadata> {
  const u = new URL(resourceUrl)
  const wellKnown = `${u.origin}/.well-known/oauth-protected-resource`
  const r1 = await fetchFn(wellKnown)
  if (!r1.ok) {
    throw new Error(`discovery: ${wellKnown} returned ${r1.status}`)
  }
  const meta1 = (await r1.json()) as { authorization_servers?: Array<string> }
  const authServer = meta1.authorization_servers?.[0]
  if (!authServer) {
    throw new Error(`discovery: no authorization_servers in resource metadata`)
  }
  const r2 = await fetchFn(
    `${authServer}/.well-known/oauth-authorization-server`
  )
  if (!r2.ok) {
    throw new Error(`discovery: auth server metadata ${r2.status}`)
  }
  const meta2 = (await r2.json()) as {
    authorization_endpoint: string
    token_endpoint: string
    device_authorization_endpoint?: string
    registration_endpoint?: string
    scopes_supported?: Array<string>
  }
  return {
    authorizationEndpoint: meta2.authorization_endpoint,
    tokenEndpoint: meta2.token_endpoint,
    deviceAuthorizationEndpoint: meta2.device_authorization_endpoint,
    registrationEndpoint: meta2.registration_endpoint,
    scopesSupported: meta2.scopes_supported,
  }
}
