import { Type } from '@sinclair/typebox'

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
  const colon = input.indexOf(`:`)
  if (colon <= 0) throw new Error(`Invalid principal identifier`)
  const kind = input.slice(0, colon) as PrincipalKind
  const id = input.slice(colon + 1)
  if (!PRINCIPAL_KINDS.has(kind)) throw new Error(`Invalid principal kind`)
  if (!id || id.includes(`/`)) throw new Error(`Invalid principal id`)
  const key = `${kind}:${id}`
  return { kind, id, key, url: `/principal/${encodeURIComponent(key)}` }
}

export function principalUrl(key: string): string {
  return parsePrincipalKey(key).url
}

export function parsePrincipalUrl(url: string): Principal | null {
  if (!url.startsWith(`/principal/`)) return null
  const segment = url.slice(`/principal/`.length)
  if (!segment || segment.includes(`/`)) return null
  try {
    // Principal URLs produced by parsePrincipalKey/principalUrl are canonical
    // encoded single path segments, but accept legacy unencoded single-segment
    // URLs here so callers can canonicalize them via parsePrincipalKey(key).url.
    return parsePrincipalKey(decodeURIComponent(segment))
  } catch {
    return null
  }
}

export function isPrincipalUrl(url: string): boolean {
  return parsePrincipalUrl(url) !== null
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
  if (!url?.startsWith(`/principal/`)) return false
  try {
    const principal = parsePrincipalUrl(url)
    if (!principal) return false
    return (
      principal.kind === `system` &&
      BUILT_IN_SYSTEM_PRINCIPAL_IDS.has(principal.id)
    )
  } catch {
    return false
  }
}

export function principalFromCreatedBy(
  createdBy: string | undefined
):
  | { url: string; key?: string | null; kind?: string; id?: string }
  | undefined {
  if (!createdBy) return undefined
  const principal = parsePrincipalUrl(createdBy)
  if (!principal) return { url: createdBy, key: null }
  return {
    url: principal.url,
    key: principal.key,
    kind: principal.kind,
    id: principal.id,
  }
}

export const principalIdentityStateSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal(`user`),
      Type.Literal(`agent`),
      Type.Literal(`service`),
      Type.Literal(`system`),
    ]),
    id: Type.String(),
    key: Type.String(),
    url: Type.String(),
    updated_at: Type.String(),
    display_name: Type.Optional(Type.String()),
    email: Type.Optional(Type.String()),
    avatar_url: Type.Optional(Type.String()),
    auth_provider: Type.Optional(Type.String()),
    auth_subject: Type.Optional(Type.String()),
    claims: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    created_at: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
)

export const principalUpdateIdentityMessageSchema = Type.Object(
  { identity: principalIdentityStateSchema },
  { additionalProperties: false }
)
