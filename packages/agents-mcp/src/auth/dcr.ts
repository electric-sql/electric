export interface RegisteredClient {
  clientId: string
  clientSecret?: string
}

export async function registerClient(opts: {
  registrationEndpoint: string
  clientName: string
  redirectUris: string[]
  grantTypes: string[]
  scopes?: string[]
  fetch?: typeof globalThis.fetch
}): Promise<RegisteredClient> {
  const f = opts.fetch ?? globalThis.fetch
  const body = {
    client_name: opts.clientName,
    redirect_uris: opts.redirectUris,
    grant_types: opts.grantTypes,
    token_endpoint_auth_method: `client_secret_post`,
    ...(opts.scopes ? { scope: opts.scopes.join(` `) } : {}),
  }
  const res = await f(opts.registrationEndpoint, {
    method: `POST`,
    body: JSON.stringify(body),
    headers: { 'Content-Type': `application/json` },
  })
  if (!res.ok) throw new Error(`DCR ${res.status}: ${await res.text()}`)
  const j = (await res.json()) as { client_id: string; client_secret?: string }
  return { clientId: j.client_id, clientSecret: j.client_secret }
}
