/**
 * HTTP routes for ensuring observation backing streams.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json } from 'itty-router'
import { routeBody, withSchema } from './schema.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

const stringRecordSchema = Type.Record(Type.String(), Type.String())

const ensureEntitiesMembershipStreamBodySchema = Type.Object({
  tags: Type.Optional(stringRecordSchema),
})

const ensureCronStreamBodySchema = Type.Object({
  expression: Type.String(),
  timezone: Type.Optional(Type.String()),
})

type EnsureEntitiesMembershipStreamBody = Static<
  typeof ensureEntitiesMembershipStreamBodySchema
>
type EnsureCronStreamBody = Static<typeof ensureCronStreamBodySchema>

export type ObservationsRoutes = RouterType<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>

export const observationsRouter: ObservationsRoutes = Router<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/_electric/observations`,
})

observationsRouter.post(
  `/entities/ensure-stream`,
  withSchema(ensureEntitiesMembershipStreamBodySchema),
  ensureEntitiesMembershipStream
)
observationsRouter.post(
  `/cron/ensure-stream`,
  withSchema(ensureCronStreamBodySchema),
  ensureCronStream
)

async function ensureEntitiesMembershipStream(
  request: JsonRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<EnsureEntitiesMembershipStreamBody>(request)
  const result = await ctx.entityManager.ensureEntitiesMembershipStream(
    parsed.tags ?? {},
    ctx.principal
  )
  return json(result)
}

async function ensureCronStream(
  request: JsonRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<EnsureCronStreamBody>(request)
  const streamPath = await ctx.entityManager.getOrCreateCronStream(
    parsed.expression,
    parsed.timezone
  )
  return json({ streamUrl: streamPath })
}
