/**
 * HTTP routes for Electric Agents entity management.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json, status } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import {
  ErrCodeNotFound,
  ErrCodeUnknownEntityType,
  toPublicEntity,
} from '../electric-agents-types.js'
import { routeBody, withSchema } from './schema.js'
import type { ElectricAgentsEntity } from '../electric-agents-types.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

interface AgentsRouteRequest extends JsonRouteRequest {
  entityRoute?: ExistingEntityRoute
}

type ExistingEntityRoute = { entityUrl: string; entity: ElectricAgentsEntity }
type AgentsRouteArgs = [TenantContext]
type AgentsRouteResult = Response | undefined

export type EntitiesRoutes = RouterType<
  AgentsRouteRequest,
  AgentsRouteArgs,
  AgentsRouteResult
>

const stringRecordSchema = Type.Record(Type.String(), Type.String())

const wakeConditionSchema = Type.Union([
  Type.Literal(`runFinished`),
  Type.Object({
    on: Type.Literal(`change`),
    collections: Type.Optional(Type.Array(Type.String())),
    ops: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal(`insert`),
          Type.Literal(`update`),
          Type.Literal(`delete`),
        ])
      )
    ),
  }),
])

const spawnBodySchema = Type.Object({
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  tags: Type.Optional(stringRecordSchema),
  parent: Type.Optional(Type.String()),
  initialMessage: Type.Optional(Type.Unknown()),
  wake: Type.Optional(
    Type.Object({
      subscriberUrl: Type.String(),
      condition: wakeConditionSchema,
      debounceMs: Type.Optional(Type.Number()),
      timeoutMs: Type.Optional(Type.Number()),
      includeResponse: Type.Optional(Type.Boolean()),
    })
  ),
})

const sendBodySchema = Type.Object({
  from: Type.Optional(Type.String()),
  payload: Type.Optional(Type.Unknown()),
  key: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  afterMs: Type.Optional(Type.Number()),
})

const forkBodySchema = Type.Object({
  instance_id: Type.Optional(Type.String()),
  waitTimeoutMs: Type.Optional(Type.Number()),
})

const setTagBodySchema = Type.Object({
  value: Type.String(),
})

const scheduleBodySchema = Type.Union([
  Type.Object({
    scheduleType: Type.Literal(`cron`),
    expression: Type.String(),
    timezone: Type.Optional(Type.String()),
    payload: Type.Unknown(),
    debounceMs: Type.Optional(Type.Number()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    scheduleType: Type.Literal(`future_send`),
    payload: Type.Unknown(),
    targetUrl: Type.Optional(Type.String()),
    fireAt: Type.String(),
    from: Type.Optional(Type.String()),
    messageType: Type.Optional(Type.String()),
  }),
])

const entitiesRegisterBodySchema = Type.Object({
  tags: Type.Optional(stringRecordSchema),
})

type SpawnBody = Static<typeof spawnBodySchema>
type SendBody = Static<typeof sendBodySchema>
type ForkBody = Static<typeof forkBodySchema>
type SetTagBody = Static<typeof setTagBodySchema>
type ScheduleBody = Static<typeof scheduleBodySchema>
type EntitiesRegisterBody = Static<typeof entitiesRegisterBodySchema>

export const entitiesRouter: EntitiesRoutes = Router<
  AgentsRouteRequest,
  AgentsRouteArgs,
  AgentsRouteResult
>({
  base: `/_electric/entities`,
})

entitiesRouter.get(`/`, listEntities)
entitiesRouter.post(
  `/register`,
  withSchema(entitiesRegisterBodySchema),
  registerEntitiesSource
)
entitiesRouter.put(
  `/:type/:instanceId`,
  withSpawnableEntityType,
  withSchema(spawnBodySchema),
  spawnEntity
)
entitiesRouter.get(`/:type/:instanceId`, withExistingEntity, getEntity)
entitiesRouter.head(`/:type/:instanceId`, withExistingEntity, headEntity)
entitiesRouter.delete(`/:type/:instanceId`, withExistingEntity, killEntity)
entitiesRouter.post(
  `/:type/:instanceId/send`,
  withExistingEntity,
  withSchema(sendBodySchema),
  sendEntity
)
entitiesRouter.post(
  `/:type/:instanceId/fork`,
  withExistingEntity,
  withSchema(forkBodySchema),
  forkEntity
)
entitiesRouter.post(
  `/:type/:instanceId/tags/:tagKey`,
  withExistingEntity,
  withSchema(setTagBodySchema),
  setTag
)
entitiesRouter.delete(
  `/:type/:instanceId/tags/:tagKey`,
  withExistingEntity,
  removeTag
)
entitiesRouter.put(
  `/:type/:instanceId/schedules/:scheduleId`,
  withExistingEntity,
  withSchema(scheduleBodySchema),
  upsertSchedule
)
entitiesRouter.delete(
  `/:type/:instanceId/schedules/:scheduleId`,
  withExistingEntity,
  deleteSchedule
)

function entityUrlFromSegments(
  type: string,
  instanceId: string
): string | null {
  if (!type || !instanceId) return null
  if (type.startsWith(`_`) || type.includes(`*`) || instanceId.includes(`*`)) {
    return null
  }
  return `/${type}/${instanceId}`
}

function firstQueryValue(
  value: string | Array<string> | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function requireExistingEntityRoute(
  request: AgentsRouteRequest
): ExistingEntityRoute {
  if (!request.entityRoute) {
    throw new Error(`existing entity middleware did not run`)
  }
  return request.entityRoute
}

async function withExistingEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<AgentsRouteResult> {
  const entityUrl = entityUrlFromSegments(
    request.params.type,
    request.params.instanceId
  )
  if (!entityUrl) return undefined

  const entity = await ctx.entityManager.registry.getEntity(entityUrl)
  if (!entity) {
    const entityType = await ctx.entityManager.registry.getEntityType(
      request.params.type
    )
    if (entityType) {
      return apiError(404, ErrCodeNotFound, `Entity not found at ${entityUrl}`)
    }
    return apiError(
      404,
      ErrCodeUnknownEntityType,
      `Entity type "${request.params.type}" not found`
    )
  }

  request.entityRoute = { entityUrl, entity }
  return undefined
}

async function withSpawnableEntityType(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<AgentsRouteResult> {
  if (!entityUrlFromSegments(request.params.type, request.params.instanceId)) {
    return undefined
  }

  const entityType = await ctx.entityManager.registry.getEntityType(
    request.params.type
  )
  if (!entityType) {
    return apiError(
      404,
      ErrCodeUnknownEntityType,
      `Entity type "${request.params.type}" not found`
    )
  }

  return undefined
}

async function listEntities(
  { query }: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entities } = await ctx.entityManager.registry.listEntities({
    type: firstQueryValue(query.type),
    status: firstQueryValue(query.status),
    parent: firstQueryValue(query.parent),
  })
  return json(entities.map((entity) => toPublicEntity(entity)))
}

async function registerEntitiesSource(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<EntitiesRegisterBody>(request)
  const result = await ctx.entityManager.registerEntitiesSource(
    parsed.tags ?? {}
  )
  return json(result)
}

async function upsertSchedule(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<ScheduleBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const scheduleId = decodeURIComponent(request.params.scheduleId)

  if (parsed.scheduleType === `cron`) {
    const result = await ctx.entityManager.upsertCronSchedule(entityUrl, {
      id: scheduleId,
      expression: parsed.expression,
      timezone: parsed.timezone,
      payload: parsed.payload,
      debounceMs: parsed.debounceMs,
      timeoutMs: parsed.timeoutMs,
    })
    return json(result)
  }

  if (parsed.scheduleType === `future_send`) {
    const result = await ctx.entityManager.upsertFutureSendSchedule(entityUrl, {
      id: scheduleId,
      payload: parsed.payload,
      targetUrl: parsed.targetUrl,
      fireAt: parsed.fireAt,
      from: parsed.from,
      messageType: parsed.messageType,
    })
    return json(result)
  }

  throw new Error(`schedule schema accepted an unknown scheduleType`)
}

async function deleteSchedule(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.deleteSchedule(entityUrl, {
    id: decodeURIComponent(request.params.scheduleId),
  })
  return json(result)
}

async function setTag(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SetTagBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const token =
    request.headers.get(`authorization`)?.replace(/^Bearer\s+/i, ``) ?? ``
  const updated = await ctx.entityManager.setTag(
    entityUrl,
    decodeURIComponent(request.params.tagKey),
    { value: parsed.value },
    token
  )
  return json(toPublicEntity(updated))
}

async function removeTag(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  const token =
    request.headers.get(`authorization`)?.replace(/^Bearer\s+/i, ``) ?? ``
  const updated = await ctx.entityManager.removeTag(
    entityUrl,
    decodeURIComponent(request.params.tagKey),
    token
  )
  return json(toPublicEntity(updated))
}

async function forkEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<ForkBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.forkSubtree(entityUrl, {
    rootInstanceId: parsed.instance_id,
    waitTimeoutMs: parsed.waitTimeoutMs,
  })
  return json(
    {
      root: toPublicEntity(result.root),
      entities: result.entities.map((entity) => toPublicEntity(entity)),
    },
    { status: 201 }
  )
}

async function sendEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SendBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)

  if (parsed.afterMs && parsed.afterMs > 0) {
    await ctx.entityManager.enqueueDelayedSend(
      entityUrl,
      {
        from: parsed.from,
        payload: parsed.payload,
        key: parsed.key,
        type: parsed.type,
      },
      new Date(Date.now() + parsed.afterMs)
    )
  } else {
    await ctx.entityManager.send(entityUrl, {
      from: parsed.from,
      payload: parsed.payload,
      key: parsed.key,
      type: parsed.type,
    })
  }

  return status(204)
}

async function spawnEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SpawnBody>(request)
  const entity = await ctx.entityManager.spawn(request.params.type, {
    instance_id: request.params.instanceId,
    args: parsed.args,
    tags: parsed.tags,
    parent: parsed.parent,
    initialMessage: parsed.initialMessage,
    wake: parsed.wake,
  })

  return json(
    { ...toPublicEntity(entity), txid: entity.txid },
    {
      status: 201,
      headers: { 'x-write-token': entity.write_token },
    }
  )
}

function getEntity(request: AgentsRouteRequest): Response {
  return json(toPublicEntity(requireExistingEntityRoute(request).entity))
}

function headEntity(): Response {
  return status(200)
}

async function killEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl, entity } = requireExistingEntityRoute(request)
  const result = await ctx.entityManager.kill(entityUrl)
  ctx.runtime.claimWriteTokens.clearStream(ctx.service, entity.streams.main)
  return json(result)
}
