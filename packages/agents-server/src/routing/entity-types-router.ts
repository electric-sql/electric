/**
 * HTTP routes for Electric Agents entity type management.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json, status } from 'itty-router'
import { dispatchPolicySchema } from '../dispatch-policy-schema.js'
import { ElectricAgentsError } from '../entity-manager.js'
import {
  ErrCodeNotFound,
  ErrCodeServeEndpointNameMismatch,
  ErrCodeServeEndpointUnreachable,
} from '../electric-agents-types.js'
import { apiError } from '../electric-agents-http.js'
import { routeBody, withSchema } from './schema.js'
import { rewriteLoopbackWebhookUrl } from '../utils/webhook-url.js'
import type {
  ElectricAgentsEntityType,
  RegisterEntityTypeRequest,
} from '../electric-agents-types.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

export interface ElectricAgentsEntityTypeRouteRequest
  extends JsonRouteRequest {}

type EntityTypeRouteArgs = [TenantContext]
type EntityTypeRouteResult = Response | undefined

export type ElectricAgentsEntityTypeRoutes = RouterType<
  ElectricAgentsEntityTypeRouteRequest,
  EntityTypeRouteArgs,
  EntityTypeRouteResult
>

type PublicEntityTypeResponse = ElectricAgentsEntityType & {
  input_schemas?: Record<string, Record<string, unknown>>
  output_schemas?: Record<string, Record<string, unknown>>
  revision: number
}

const jsonObjectSchema = Type.Record(Type.String(), Type.Unknown())
const schemaMapSchema = Type.Record(Type.String(), jsonObjectSchema)

const registerEntityTypeBodySchema = Type.Object({
  name: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  creation_schema: Type.Optional(jsonObjectSchema),
  inbox_schemas: Type.Optional(schemaMapSchema),
  state_schemas: Type.Optional(schemaMapSchema),
  input_schemas: Type.Optional(schemaMapSchema),
  output_schemas: Type.Optional(schemaMapSchema),
  serve_endpoint: Type.Optional(Type.String()),
  default_dispatch_policy: Type.Optional(dispatchPolicySchema),
})

const amendEntityTypeSchemasBodySchema = Type.Object({
  input_schemas: Type.Optional(schemaMapSchema),
  output_schemas: Type.Optional(schemaMapSchema),
  inbox_schemas: Type.Optional(schemaMapSchema),
  state_schemas: Type.Optional(schemaMapSchema),
})

type RegisterEntityTypeBody = Static<typeof registerEntityTypeBodySchema>
type AmendEntityTypeSchemasBody = Static<
  typeof amendEntityTypeSchemasBodySchema
>

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
  registerEntityType
)
entityTypesRouter.patch(
  `/:name/schemas`,
  withSchema(amendEntityTypeSchemasBodySchema),
  amendSchemas
)
entityTypesRouter.get(`/:name`, getEntityType)
entityTypesRouter.delete(`/:name`, deleteEntityType)

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
  return json(toPublicEntityType(entityType), { status: 201 })
}

async function listEntityTypes(
  _request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityTypes = await ctx.entityManager.registry.listEntityTypes()
  return json(entityTypes.map((entityType) => toPublicEntityType(entityType)))
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

    const entityType = await ctx.entityManager.registerEntityType(
      normalizeEntityTypeRequest(manifest)
    )
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
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const entityType = await ctx.entityManager.registry.getEntityType(
    request.params.name
  )
  if (!entityType) {
    return apiError(404, ErrCodeNotFound, `Entity type not found`)
  }

  return json(toPublicEntityType(entityType))
}

async function amendSchemas(
  request: ElectricAgentsEntityTypeRouteRequest,
  ctx: TenantContext
): Promise<EntityTypeRouteResult> {
  const parsed = routeBody<AmendEntityTypeSchemasBody>(request)

  const updated = await ctx.entityManager.amendSchemas(request.params.name, {
    inbox_schemas: parsed.inbox_schemas ?? parsed.input_schemas,
    state_schemas: parsed.state_schemas ?? parsed.output_schemas,
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

function normalizeEntityTypeRequest(
  parsed: RegisterEntityTypeBody | RegisterEntityTypeRequest
): RegisterEntityTypeRequest {
  const serveEndpoint = rewriteLoopbackWebhookUrl(parsed.serve_endpoint)
  const compatibilityFields = parsed as RegisterEntityTypeBody
  return {
    name: parsed.name ?? ``,
    description: parsed.description ?? ``,
    creation_schema: parsed.creation_schema,
    inbox_schemas: parsed.inbox_schemas ?? compatibilityFields.input_schemas,
    state_schemas: parsed.state_schemas ?? compatibilityFields.output_schemas,
    serve_endpoint: serveEndpoint,
    default_dispatch_policy:
      parsed.default_dispatch_policy ??
      (serveEndpoint
        ? ({
            targets: [{ type: `webhook`, url: serveEndpoint }],
          } as RegisterEntityTypeRequest[`default_dispatch_policy`])
        : undefined),
  }
}

function toPublicEntityType(
  entityType: ElectricAgentsEntityType
): PublicEntityTypeResponse {
  return {
    ...entityType,
    input_schemas: entityType.inbox_schemas,
    output_schemas: entityType.state_schemas,
    revision: entityType.revision,
  }
}
