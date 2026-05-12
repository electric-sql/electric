/**
 * HTTP routes under /_electric/cron.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json } from 'itty-router'
import { routeBody, withSchema } from './schema.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

const cronRegisterBodySchema = Type.Object({
  expression: Type.String(),
  timezone: Type.Optional(Type.String()),
})

type CronRegisterBody = Static<typeof cronRegisterBodySchema>

export type CronRoutes = RouterType<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>

export const cronRouter: CronRoutes = Router<
  JsonRouteRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/_electric/cron`,
})

cronRouter.post(`/register`, withSchema(cronRegisterBodySchema), registerCron)

async function registerCron(
  request: JsonRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<CronRegisterBody>(request)
  const streamPath = await ctx.entityManager.getOrCreateCronStream(
    parsed.expression,
    parsed.timezone
  )
  return json({ streamUrl: streamPath })
}
