export type PrincipalKind = `user` | `agent` | `service` | `system`

export interface Principal {
  kind: PrincipalKind
  id: string
  key: string
  url: string
}

export const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`

const PRINCIPAL_KINDS = new Set<PrincipalKind>([
  `user`,
  `agent`,
  `service`,
  `system`,
])

export function parsePrincipalKey(input: string): Principal {
  const value = input
  const colon = value.indexOf(`:`)
  if (colon <= 0) throw new Error(`Invalid principal key`)
  const kind = value.slice(0, colon) as PrincipalKind
  const id = value.slice(colon + 1)
  if (!PRINCIPAL_KINDS.has(kind)) throw new Error(`Invalid principal kind`)
  if (!id || id.includes(`/`)) throw new Error(`Invalid principal id`)
  const key = `${kind}:${id}`
  return { kind, id, key, url: `/principal/${key}` }
}

export function principalUrl(key: string): string {
  return parsePrincipalKey(key).url
}

export function principalKeyFromUrl(url: string): string | null {
  if (!url.startsWith(`/principal/`)) return null
  const key = url.slice(`/principal/`.length)
  try {
    return parsePrincipalKey(key).key
  } catch {
    return null
  }
}

export function getPrincipalFromRequest(request: Request): Principal | null {
  const value = request.headers.get(ELECTRIC_PRINCIPAL_HEADER)
  return value ? parsePrincipalKey(value) : null
}

export function getDevPrincipal(): Principal {
  return parsePrincipalKey(`system:dev-local`)
}

const BUILT_IN_SYSTEM_PRINCIPAL_IDS = new Set([
  `framework`,
  `auth-sync`,
  `dev-local`,
])

export function isBuiltInSystemPrincipalUrl(url: string | undefined): boolean {
  if (!url) return false
  const key = principalKeyFromUrl(url)
  if (!key) return false
  const principal = parsePrincipalKey(key)
  return (
    principal.kind === `system` &&
    BUILT_IN_SYSTEM_PRINCIPAL_IDS.has(principal.id)
  )
}

export const principalIdentityStateSchema = {
  type: `object`,
  additionalProperties: false,
  required: [`kind`, `id`, `key`, `url`, `updated_at`],
  properties: {
    kind: { enum: [`user`, `agent`, `service`, `system`] },
    id: { type: `string` },
    key: { type: `string` },
    url: { type: `string` },
    display_name: { type: `string` },
    email: { type: `string` },
    avatar_url: { type: `string` },
    auth_provider: { type: `string` },
    auth_subject: { type: `string` },
    claims: { type: `object`, additionalProperties: true },
    created_at: { type: `string` },
    updated_at: { type: `string` },
  },
}

export const principalUpdateIdentityMessageSchema = {
  type: `object`,
  additionalProperties: false,
  required: [`identity`],
  properties: { identity: principalIdentityStateSchema },
}
