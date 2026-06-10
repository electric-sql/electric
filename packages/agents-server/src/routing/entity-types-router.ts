/**
 * HTTP routes for Electric Agents entity type management.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json, status } from 'itty-router'
import { dispatchPolicySchema } from '../dispatch-policy-schema.js'
import { ElectricAgentsError } from '../entity-manager.js'
import {
  ErrCodeNotFound,
  ErrCodeInvalidRequest,
  ErrCodeUnauthorized,
  ErrCodeServeEndpointNameMismatch,
  ErrCodeServeEndpointUnreachable,
} from '../electric-agents-types.js'
import { apiError } from '../electric-agents-http.js'
import { routeBody, withSchema } from './schema.js'
import { rewriteLoopbackWebhookUrl } from '../utils/webhook-url.js'
import { canAccessEntityType, canRegisterEntityType } from '../permissions.js'
import type {
  ElectricAgentsEntityType,
  RegisterEntityTypeRequest,
  EntityTypePermissionGrantInput,
} from '../electric-agents-types.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

export interface ElectricAgentsEntityTypeRouteRequest extends JsonRouteRequest {
  entityTypeRoute?: { entityType: ElectricAgentsEntityType }
}

type EntityTypeRouteArgs = [TenantContext]
type EntityTypeRouteResult = Response | undefined

export type ElectricAgentsEntityTypeRoutes = RouterType<
  ElectricAgentsEntityTypeRouteRequest,
  EntityTypeRouteArgs,
  EntityTypeRouteResult
>

type PublicEntityTypeResponse = ElectricAgentsEntityType & {
  revision: number
}

const jsonObjectSchema = Type.Record(Type.String(), Type.Unknown())
const schemaMapSchema = Type.Record(Type.String(), jsonObjectSchema)
const writableCollectionsSchema = Type.Record(
  Type.String(),
  Type.Object(
    { type: Type.String(), principalColumn: Type.String() },
    { additionalProperties: false }
  )
)
const slashCommandArgumentSchema = Type.Object(
  {
    name: Type.String(),
    type: Type.Union([
      Type.Literal(`string`),
      Type.Literal(`number`),
      Type.Literal(`boolean`),
    ]),
    required: Type.Optional(Type.Boolean()),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
)
const slashCommandSchema = Type.Object(
  {
    name: Type.String(),
    description: Type.Optional(Type.String()),
    arguments: Type.Optional(Type.Array(slashCommandArgumentSchema)),
  },
  { additionalProperties: false }
)

const typePermissionGrantInputSchema = Type.Object(
  {
    subject_kind: Type.Union([
      Type.Literal(`principal`),
      Type.Literal(`principal_kind`),
    ]),
    subject_value: Type.String(),
    permission: Type.Union([Type.Literal(`spawn`), Type.Literal(`manage`)]),
    expires_at: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
)

const registerEntityTypeBodySchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    creation_schema: Type.Optional(jsonObjectSchema),
    inbox_schemas: Type.Optional(schemaMapSchema),
    state_schemas: Type.Optional(schemaMapSchema),
    slash_commands: Type.Optional(Type.Array(slashCommandSchema)),
    serve_endpoint: Type.Optional(Type.String()),
    default_dispatch_policy: Type.Optional(dispatchPolicySchema),
    permission_grants: Type.Optional(
      Type.Array(typePermissionGrantInputSchema)
    ),
    writable_collections: Type.Optional(writableCollectionsSchema),
  },
  { additionalProperties: false }
)

const amendEntityTypeSchemasBodySchema = Type.Object(
  {
    inbox_schemas: Type.Optional(schemaMapSchema),
    state_schemas: Type.Optional(schemaMapSchema),
  },
  { additionalProperties: false }
)

type RegisterEntityTypeBody = Static<typeof registerEntityTypeBodySchema>
type AmendEntityTypeSchemasBody = Static<
  typeof amendEntityTypeSchemasBodySchema
>
type TypePermissionGrantInput = EntityTypePermissionGrantInput

export const entityTypesRouter: ElectricAgentsEntityTypeRoutes = Router<
  ElectricAgentsEntityTypeRouteRequest,
  EntityTypeRouteArgs,
  EntityTypeRouteResult
>({
  base: `/_electric/entity-types`,
})

entityTypesRouter.get(`/`, listEntityTypes)
entityTypesRouter.post(
  `/`,
  withSchema(registerEntityTypeBodySchema),
  withEntityTypeRegistrationPermission,
  registerEntityType
)
entityTypesRouter.patch(
  `/:name/schemas`,
  withExistingEntityType,
  withEntityTypeManagePermission,
  withSchema(amendEntityTypeSchemasBodySchema),
  amendSchemas
)
entityTypesRouter.get(
  `/:name`,
  withExistingEntityType,
  withEntityTypeSpawnPermission,
  getEntityType
)
entityTypesRouter.delete(
  `/:name`,
  withExistingEntityType,
  withEntityTypeManagePermission,
  deleteEntityType
)
entityTypesRouter.get(
  `/:name/grants`,
  withExistingEntityType,
  withEntityTypeManagePermission,
  listTypePermissionGrants
)
entityTypesRouter.post(
  `/:name/grants`,
  withExistingEntityType,
  withSchema(typePermissionGrantInputSchema),
  withEntityTypeManagePermission,
  createTypePermissionGrant
)
entityTypesRouter.delete(
  `/:name/grants/:grantId`,
  withExistingEntityType,
  withEntityTypeManagePermission,
  deleteTypePermissionGrant
)

async function registerEntityType(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const parsed = routeBody<RegisterEntityTypeBody>(request)
  const normalized = normalizeEntityTypeRequest(parsed)

  if (
    normalized.serve_endpoint &&
    !normalized.description &&
    !normalized.creation_schema
  ) {
    return await discoverServeEndpoint(ctx, normalized)
  }

  const entityType = await ctx.entityManager.registerEntityType(normalized)
  await applyRegistrationPermissionGrants(ctx, entityType.name, normalized)
  return json(toPublicEntityType(entityType), { status: 201 })
}

async function listEntityTypes(
  _request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityTypes = await ctx.entityManager.registry.listEntityTypes()
  const visible: Array<ElectricAgentsEntityType> = []
  for (const entityType of entityTypes) {
    if (await canAccessEntityType(ctx, entityType, `spawn`)) {
      visible.push(entityType)
    }
  }
  return json(visible.map((entityType) => toPublicEntityType(entityType)))
}

async function withExistingEntityType(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityType = await ctx.entityManager.registry.getEntityType(
    request.params.name
  )
  if (!entityType) {
    return apiError(404, ErrCodeNotFound, `Entity type not found`)
  }
  request.entityTypeRoute = { entityType }
  return undefined
}

async function withEntityTypeManagePermission(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityType = request.entityTypeRoute?.entityType
  if (!entityType) {
    throw new Error(`entity type middleware did not run`)
  }
  if (
    await canAccessEntityType(ctx, entityType, `manage`, request as Request)
  ) {
    return undefined
  }
  return apiError(
    401,
    ErrCodeUnauthorized,
    `Principal is not allowed to manage ${entityType.name}`
  )
}

async function withEntityTypeSpawnPermission(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityType = request.entityTypeRoute?.entityType
  if (!entityType) {
    throw new Error(`entity type middleware did not run`)
  }
  if (await canAccessEntityType(ctx, entityType, `spawn`, request as Request)) {
    return undefined
  }
  return apiError(
    401,
    ErrCodeUnauthorized,
    `Principal is not allowed to spawn ${entityType.name}`
  )
}

async function withEntityTypeRegistrationPermission(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const parsed = normalizeEntityTypeRequest(
    routeBody<RegisterEntityTypeBody>(request)
  )
  if (!parsed.name) {
    return undefined
  }

  const existing = await ctx.entityManager.registry.getEntityType(parsed.name)
  if (existing) {
    request.entityTypeRoute = { entityType: existing }
    if (
      await canAccessEntityType(ctx, existing, `manage`, request as Request)
    ) {
      return undefined
    }
    return apiError(
      401,
      ErrCodeUnauthorized,
      `Principal is not allowed to manage ${existing.name}`
    )
  }

  if (await canRegisterEntityType(ctx, parsed, request as Request)) {
    return undefined
  }

  return apiError(
    401,
    ErrCodeUnauthorized,
    `Principal is not allowed to register entity types`
  )
}

async function discoverServeEndpoint(
  ctx: TenantContext,
  parsed: RegisterEntityTypeRequest
): Promise<Response> {
  try {
    const response = await fetch(parsed.serve_endpoint!, { method: `PUT` })

    if (!response.ok) {
      return apiError(
        502,
        ErrCodeServeEndpointUnreachable,
        `Serve endpoint returned status ${response.status}`
      )
    }

    const manifest = (await response.json()) as RegisterEntityTypeRequest
    if (manifest.name !== parsed.name) {
      return apiError(
        400,
        ErrCodeServeEndpointNameMismatch,
        `Serve endpoint returned name "${manifest.name}" but expected "${parsed.name}"`
      )
    }

    manifest.serve_endpoint = parsed.serve_endpoint
    manifest.permission_grants = parsed.permission_grants

    const entityType = await ctx.entityManager.registerEntityType(
      normalizeEntityTypeRequest(manifest)
    )
    await applyRegistrationPermissionGrants(ctx, entityType.name, manifest)
    return json(toPublicEntityType(entityType), { status: 201 })
  } catch (err) {
    if (err instanceof ElectricAgentsError) {
      throw err
    }
    return apiError(
      502,
      ErrCodeServeEndpointUnreachable,
      `Failed to reach serve endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

async function getEntityType(
  request: ElectricAgentsEntityTypeRouteRequest
): Promise<EntityTypeRouteResult> {
  return json(toPublicEntityType(request.entityTypeRoute!.entityType))
}

async function amendSchemas(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const parsed = routeBody<AmendEntityTypeSchemasBody>(request)

  const updated = await ctx.entityManager.amendSchemas(request.params.name, {
    inbox_schemas: parsed.inbox_schemas,
    state_schemas: parsed.state_schemas,
  })
  return json(toPublicEntityType(updated))
}

async function deleteEntityType(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  await ctx.entityManager.deleteEntityType(request.params.name)
  return status(204)
}

async function listTypePermissionGrants(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const grants =
    await ctx.entityManager.registry.listEntityTypePermissionGrants(
      request.entityTypeRoute!.entityType.name
    )
  return json({ grants })
}

async function createTypePermissionGrant(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const parsed = routeBody<TypePermissionGrantInput>(request)
  const grant =
    await ctx.entityManager.registry.createEntityTypePermissionGrant({
      entityType: request.entityTypeRoute!.entityType.name,
      permission: parsed.permission,
      subjectKind: parsed.subject_kind,
      subjectValue: parsed.subject_value,
      expiresAt: parseExpiresAt(parsed.expires_at),
      createdBy: ctx.principal.url,
    })
  return json(grant, { status: 201 })
}

async function deleteTypePermissionGrant(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const deleted =
    await ctx.entityManager.registry.deleteEntityTypePermissionGrant(
      request.entityTypeRoute!.entityType.name,
      parseGrantId(request)
    )
  return deleted
    ? status(204)
    : apiError(404, ErrCodeNotFound, `Grant not found`)
}

async function applyRegistrationPermissionGrants(
  ctx: TenantContext,
  entityType: string,
  request: Pick<RegisterEntityTypeRequest, `permission_grants`>
): Promise<void> {
  for (const grant of request.permission_grants ?? []) {
    await ctx.entityManager.registry.ensureEntityTypePermissionGrant({
      entityType,
      permission: grant.permission,
      subjectKind: grant.subject_kind,
      subjectValue: grant.subject_value,
      expiresAt: parseExpiresAt(grant.expires_at),
      createdBy: ctx.principal.url,
    })
  }
}

function parseGrantId(request: ElectricAgentsEntityTypeRouteRequest): number {
  const grantId = Number.parseInt(String(request.params.grantId), 10)
  if (!Number.isSafeInteger(grantId) || grantId <= 0) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Invalid grant id`,
      400
    )
  }
  return grantId
}

function parseExpiresAt(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Invalid expires_at timestamp`,
      400
    )
  }
  return expiresAt
}

function normalizeEntityTypeRequest(
  parsed: RegisterEntityTypeBody | RegisterEntityTypeRequest
): RegisterEntityTypeRequest {
  const serveEndpoint = rewriteLoopbackWebhookUrl(parsed.serve_endpoint)
  return {
    name: parsed.name ?? ``,
    description: parsed.description ?? ``,
    creation_schema: parsed.creation_schema,
    inbox_schemas: parsed.inbox_schemas,
    state_schemas: parsed.state_schemas,
    slash_commands: parsed.slash_commands,
    serve_endpoint: serveEndpoint,
    default_dispatch_policy:
      parsed.default_dispatch_policy ??
      (serveEndpoint
        ? ({
            targets: [{ type: `webhook`, url: serveEndpoint }],
          } as RegisterEntityTypeRequest[`default_dispatch_policy`])
        : undefined),
    permission_grants: parsed.permission_grants,
    writable_collections: parsed.writable_collections,
  }
}

function toPublicEntityType(
  entityType: ElectricAgentsEntityType
): PublicEntityTypeResponse {
  return {
    ...entityType,
    revision: entityType.revision,
  }
}
