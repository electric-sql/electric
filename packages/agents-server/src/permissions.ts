import { isBuiltInSystemPrincipalUrl } from './principal.js'
import type {
  AuthorizeRequest,
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
  EntityPermission,
  RegisterEntityTypeRequest,
  EntityTypePermission,
} from './electric-agents-types.js'
import type { TenantContext } from './routing/context.js'
import { serverLog } from './utils/log.js'

const authzDecisionCache = new WeakMap<
  AuthorizeRequest,
  Map<string, { decision: `allow` | `deny`; expiresAt: number }>
>()

export function principalSubject(principal: { url: string; kind: string }): {
  principalUrl: string
  principalKind: string
} {
  return { principalUrl: principal.url, principalKind: principal.kind }
}

export function isPermissionBypassPrincipal(ctx: TenantContext): boolean {
  return isBuiltInSystemPrincipalUrl(ctx.principal.url)
}

export async function canAccessEntity(
  ctx: TenantContext,
  entity: ElectricAgentsEntity,
  permission: EntityPermission,
  request?: Request
): Promise<boolean> {
  if (isPermissionBypassPrincipal(ctx)) return true
  await ctx.entityManager.registry.pruneExpiredPermissionGrants?.()

  const builtInAllowed =
    entity.created_by === ctx.principal.url ||
    (await ctx.entityManager.registry.hasEntityPermission(
      entity.url,
      permission,
      principalSubject(ctx.principal)
    ))

  return await applyAuthorizationHook(ctx, {
    verb: permission,
    resourceKey: `entity:${entity.url}`,
    resource: { kind: `entity`, entity },
    builtInAllowed,
    request,
  })
}

export async function canAccessEntityType(
  ctx: TenantContext,
  entityType: ElectricAgentsEntityType,
  permission: EntityTypePermission,
  request?: Request
): Promise<boolean> {
  if (isPermissionBypassPrincipal(ctx)) return true
  await ctx.entityManager.registry.pruneExpiredPermissionGrants?.()

  const builtInAllowed =
    await ctx.entityManager.registry.hasEntityTypePermission(
      entityType.name,
      permission,
      principalSubject(ctx.principal)
    )

  return await applyAuthorizationHook(ctx, {
    verb: permission,
    resourceKey: `entity_type:${entityType.name}`,
    resource: { kind: `entity_type`, entityType },
    builtInAllowed,
    request,
  })
}

export async function canRegisterEntityType(
  ctx: TenantContext,
  input: Pick<RegisterEntityTypeRequest, `name`>,
  request?: Request
): Promise<boolean> {
  if (isPermissionBypassPrincipal(ctx)) return true

  return await applyAuthorizationHook(ctx, {
    verb: `manage`,
    resourceKey: `entity_type_registration:${input.name}`,
    resource: {
      kind: `entity_type_registration`,
      entityTypeName: input.name,
    },
    builtInAllowed: true,
    request,
  })
}

export async function canAccessSharedState(
  ctx: TenantContext,
  sharedStateId: string,
  permission: `read` | `write`,
  request?: Request,
  ownerEntityUrl?: string
): Promise<boolean> {
  if (isPermissionBypassPrincipal(ctx)) return true
  await ctx.entityManager.registry.pruneExpiredPermissionGrants?.()

  const storedLinkedEntityUrls =
    await ctx.entityManager.registry.listSharedStateLinkedEntityUrls(
      sharedStateId
    )
  const bootstrapEntityUrls =
    storedLinkedEntityUrls.length === 0 && ownerEntityUrl
      ? [ownerEntityUrl]
      : []
  const linkedEntityUrls = [
    ...new Set([...storedLinkedEntityUrls, ...bootstrapEntityUrls]),
  ]
  for (const entityUrl of linkedEntityUrls) {
    const entity = await ctx.entityManager.registry.getEntity(entityUrl)
    if (!entity) continue
    if (
      entity.created_by === ctx.principal.url ||
      (await ctx.entityManager.registry.hasEntityPermission(
        entity.url,
        permission,
        principalSubject(ctx.principal)
      ))
    ) {
      return await applyAuthorizationHook(ctx, {
        verb: permission,
        resourceKey: `shared_state:${sharedStateId}`,
        resource: {
          kind: `shared_state`,
          sharedStateId,
          linkedEntityUrls,
        },
        builtInAllowed: true,
        request,
      })
    }
  }

  return await applyAuthorizationHook(ctx, {
    verb: permission,
    resourceKey: `shared_state:${sharedStateId}`,
    resource: {
      kind: `shared_state`,
      sharedStateId,
      linkedEntityUrls,
    },
    builtInAllowed: false,
    request,
  })
}

async function applyAuthorizationHook(
  ctx: TenantContext,
  input: {
    verb: EntityPermission | EntityTypePermission
    resourceKey: string
    resource: Parameters<AuthorizeRequest>[0][`resource`]
    builtInAllowed: boolean
    request?: Request
  }
): Promise<boolean> {
  const hook = ctx.authorizeRequest
  if (!hook) return input.builtInAllowed

  const cacheKey = [
    ctx.service,
    ctx.principal.url,
    input.verb,
    input.resourceKey,
  ].join(`|`)
  const cached = getCachedDecision(hook, cacheKey)
  if (cached) return cached.decision === `allow`

  let decision: Awaited<ReturnType<AuthorizeRequest>>
  try {
    decision = await hook({
      tenant: ctx.service,
      principal: ctx.principal,
      verb: input.verb,
      resource: input.resource,
      request: input.request ? requestMetadata(input.request) : undefined,
      builtInAllowed: input.builtInAllowed,
    })
  } catch (error) {
    serverLog.warn(`[agent-server] authorization hook failed:`, error)
    return false
  }

  cacheDecision(hook, cacheKey, decision)
  return decision.decision === `allow`
}

function getCachedDecision(
  hook: AuthorizeRequest,
  cacheKey: string
): { decision: `allow` | `deny` } | null {
  const cache = authzDecisionCache.get(hook)
  const entry = cache?.get(cacheKey)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache?.delete(cacheKey)
    return null
  }
  return { decision: entry.decision }
}

function cacheDecision(
  hook: AuthorizeRequest,
  cacheKey: string,
  decision: Awaited<ReturnType<AuthorizeRequest>>
): void {
  if (!decision.expires_at) return
  const expiresAt = Date.parse(decision.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return
  let cache = authzDecisionCache.get(hook)
  if (!cache) {
    cache = new Map()
    authzDecisionCache.set(hook, cache)
  }
  cache.set(cacheKey, { decision: decision.decision, expiresAt })
}

function requestMetadata(request: Request): {
  method: string
  url: string
  headers: Record<string, string>
} {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  return { method: request.method, url: request.url, headers }
}
