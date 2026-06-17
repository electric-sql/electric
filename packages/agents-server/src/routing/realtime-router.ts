/**
 * HTTP routes for realtime session management.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import {
  ErrCodeNotFound,
  ErrCodeUnauthorized,
} from '../electric-agents-types.js'
import { canAccessEntity } from '../permissions.js'
import { routeBody, withSchema } from './schema.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

interface RealtimeRouteRequest extends JsonRouteRequest {}

type RealtimeRouteArgs = [TenantContext]
type RealtimeRouteResult = Response | undefined

export type RealtimeRoutes = RouterType<
  RealtimeRouteRequest,
  RealtimeRouteArgs,
  RealtimeRouteResult
>

const realtimeAudioRequestSchema = Type.Object(
  {
    codec: Type.Optional(Type.Literal(`pcm16`)),
    sampleRate: Type.Optional(Type.Number()),
    channels: Type.Optional(Type.Number()),
  },
  { additionalProperties: false }
)

const realtimeSessionCreateBodySchema = Type.Object(
  {
    entityUrl: Type.String(),
    id: Type.Optional(Type.String()),
    provider: Type.String(),
    model: Type.String(),
    voice: Type.Optional(Type.String()),
    reasoningEffort: Type.Optional(
      Type.Union([
        Type.Literal(`low`),
        Type.Literal(`medium`),
        Type.Literal(`high`),
      ])
    ),
    interruptResponse: Type.Optional(Type.Boolean()),
    inputAudio: Type.Optional(realtimeAudioRequestSchema),
    outputAudio: Type.Optional(realtimeAudioRequestSchema),
    meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
)

type RealtimeSessionCreateBody = Static<typeof realtimeSessionCreateBodySchema>

export const realtimeRouter: RealtimeRoutes = Router<
  RealtimeRouteRequest,
  RealtimeRouteArgs,
  RealtimeRouteResult
>({
  base: `/_electric/realtime`,
})

realtimeRouter.post(
  `/sessions`,
  withSchema(realtimeSessionCreateBodySchema),
  createRealtimeSession
)

async function createRealtimeSession(
  request: RealtimeRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<RealtimeSessionCreateBody>(request)
  const entity = await ctx.entityManager.registry.getEntity(parsed.entityUrl)
  if (!entity) {
    return apiError(404, ErrCodeNotFound, `Entity not found`)
  }
  if (!(await canAccessEntity(ctx, entity, `write`, request as Request))) {
    return apiError(
      401,
      ErrCodeUnauthorized,
      `Principal is not allowed to write ${entity.url}`
    )
  }

  const result = await ctx.entityManager.createRealtimeSession(
    parsed.entityUrl,
    parsed
  )
  return json(result, { status: 201 })
}
