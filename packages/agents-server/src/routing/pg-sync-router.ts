/**
 * HTTP routes for pg-sync observation source registration.
 */

import type { PgSyncOptions } from '@electric-ax/agents-runtime'
import { Type, type Static } from '@sinclair/typebox'
import { Router, json } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import { ErrCodeInvalidRequest } from '../electric-agents-types.js'
import { routeBody, withSchema } from './schema.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

const pgSyncOptionsSchema = Type.Object({
  url: Type.Optional(Type.String()),
  table: Type.String(),
  columns: Type.Optional(Type.Array(Type.String())),
  where: Type.Optional(Type.String()),
  params: Type.Optional(
    Type.Union([
      Type.Array(Type.String()),
      Type.Record(Type.String(), Type.String()),
    ])
  ),
  replica: Type.Optional(
    Type.Union([Type.Literal(`default`), Type.Literal(`full`)])
  ),
})

const pgSyncRegisterBodySchema = Type.Object({
  options: pgSyncOptionsSchema,
})

type PgSyncRegisterBody = Static<typeof pgSyncRegisterBodySchema>

export type PgSyncRoutes = RouterType<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>

export const pgSyncRouter: PgSyncRoutes = Router<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/_electric/pg-sync`,
})

pgSyncRouter.post(
  `/register`,
  withSchema(pgSyncRegisterBodySchema),
  registerPgSync
)

async function registerPgSync(
  request: JsonRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { options } = routeBody<PgSyncRegisterBody>(request)

  if (options.table.trim() === ``) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `pgSync table must be non-empty`
    )
  }

  if (!ctx.pgSyncBridgeManager) {
    return apiError(
      503,
      ErrCodeInvalidRequest,
      `pgSync bridge manager is not configured`
    )
  }

  try {
    const result = await ctx.pgSyncBridgeManager.register(
      options as PgSyncOptions
    )

    return json(result)
  } catch (error) {
    return apiError(
      500,
      ErrCodeInvalidRequest,
      `pgSync registration failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
