/**
 * HTTP routes for Electric Agents entity management.
 */

import { Type, type Static } from '@sinclair/typebox'
import { Router, json, status } from 'itty-router'
import { apiError } from '../electric-agents-http.js'
import { parsePrincipalKey, principalUrl } from '../principal.js'
import { dispatchPolicySchema } from '../dispatch-policy-schema.js'
import {
  ErrCodeNotFound,
  ErrCodeUnknownEntityType,
  ErrCodeInvalidRequest,
  toPublicEntity,
} from '../electric-agents-types.js'
import {
  assertDispatchPolicyAllowed,
  backfillEntityDispatchPolicy,
  linkEntityDispatchSubscription,
  resolveEffectiveDispatchPolicyForSpawn,
  unlinkEntityDispatchSubscription,
} from './dispatch-policy.js'
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

function writeTokenFromRequest(request: AgentsRouteRequest): string {
  const electricClaimToken = request.headers.get(`electric-claim-token`)?.trim()
  if (electricClaimToken) return electricClaimToken
  return (
    request.headers
      .get(`authorization`)
      ?.replace(/^Bearer\s+/i, ``)
      .trim() ?? ``
  )
}

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
  dispatch_policy: Type.Optional(dispatchPolicySchema),
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
  payload: Type.Optional(Type.Unknown()),
  key: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal(`immediate`),
      Type.Literal(`queued`),
      Type.Literal(`paused`),
      Type.Literal(`steer`),
    ])
  ),
  position: Type.Optional(Type.String()),
  afterMs: Type.Optional(Type.Number()),
  from: Type.Optional(Type.String()),
})

const inboxMessageBodySchema = Type.Object({
  payload: Type.Optional(Type.Unknown()),
  position: Type.Optional(Type.String()),
  mode: Type.Optional(
    Type.Union([
      Type.Literal(`immediate`),
      Type.Literal(`queued`),
      Type.Literal(`paused`),
      Type.Literal(`steer`),
    ])
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal(`pending`),
      Type.Literal(`processed`),
      Type.Literal(`cancelled`),
    ])
  ),
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
    messageType: Type.Optional(Type.String()),
    from: Type.Optional(Type.String()),
  }),
])

const entitiesRegisterBodySchema = Type.Object({
  tags: Type.Optional(stringRecordSchema),
})

type SpawnBody = Static<typeof spawnBodySchema>
type SendBody = Static<typeof sendBodySchema>
type InboxMessageBody = Static<typeof inboxMessageBodySchema>
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
entitiesRouter.patch(
  `/:type/:instanceId/inbox/:messageKey`,
  withExistingEntity,
  withSchema(inboxMessageBodySchema),
  updateInboxMessage
)
entitiesRouter.delete(
  `/:type/:instanceId/inbox/:messageKey`,
  withExistingEntity,
  deleteInboxMessage
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
  if (type === `principal`) {
    try {
      return principalUrl(decodeURIComponent(instanceId))
    } catch {
      return null
    }
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

function rejectPrincipalEntityMutation(
  request: AgentsRouteRequest,
  action: string
): Response | undefined {
  const { entity } = requireExistingEntityRoute(request)
  if (entity.type !== `principal`) return undefined

  return apiError(
    400,
    ErrCodeInvalidRequest,
    `Principal entities are built in and cannot be ${action}`
  )
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
    if (request.params.type === `principal`) {
      try {
        const materialized = await ctx.entityManager.ensurePrincipal(
          parsePrincipalKey(decodeURIComponent(request.params.instanceId))
        )
        request.entityRoute = { entityUrl, entity: materialized }
        return undefined
      } catch (error) {
        return apiError(
          400,
          ErrCodeInvalidRequest,
          error instanceof Error ? error.message : `Invalid principal`
        )
      }
    }
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

  if (request.params.type === `principal`) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `Principal entities are built in and cannot be spawned directly`
    )
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
    created_by: firstQueryValue(query.created_by),
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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `scheduled`
  )
  if (principalMutationError) return principalMutationError

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
    if (parsed.from !== undefined && parsed.from !== ctx.principal.url) {
      return apiError(
        400,
        ErrCodeInvalidRequest,
        `Request from must match Electric-Principal`
      )
    }
    const result = await ctx.entityManager.upsertFutureSendSchedule(entityUrl, {
      id: scheduleId,
      payload: parsed.payload,
      targetUrl: parsed.targetUrl,
      fireAt: parsed.fireAt,
      senderUrl: ctx.principal.url,
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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `unscheduled`
  )
  if (principalMutationError) return principalMutationError

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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `tagged`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<SetTagBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  const token = writeTokenFromRequest(request)
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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `untagged`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl } = requireExistingEntityRoute(request)
  const token = writeTokenFromRequest(request)
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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `forked`
  )
  if (principalMutationError) return principalMutationError

  const parsed = routeBody<ForkBody>(request)
  const { entityUrl, entity } = requireExistingEntityRoute(request)
  await assertDispatchPolicyAllowed(ctx, entity.dispatch_policy)
  const result = await ctx.entityManager.forkSubtree(entityUrl, {
    rootInstanceId: parsed.instance_id,
    waitTimeoutMs: parsed.waitTimeoutMs,
  })
  for (const forkedEntity of result.entities) {
    await linkEntityDispatchSubscription(ctx, forkedEntity)
  }
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
  const principal = ctx.principal
  if (parsed.from !== undefined && parsed.from !== principal.url) {
    return apiError(
      400,
      ErrCodeInvalidRequest,
      `Request from must match Electric-Principal`
    )
  }
  await ctx.entityManager.ensurePrincipal(principal)
  const { entityUrl, entity } = requireExistingEntityRoute(request)

  const dispatchEntity = entity.dispatch_policy
    ? entity
    : await backfillEntityDispatchPolicy(ctx, entity)
  await linkEntityDispatchSubscription(ctx, dispatchEntity)

  if (parsed.afterMs && parsed.afterMs > 0) {
    await ctx.entityManager.enqueueDelayedSend(
      entityUrl,
      {
        from: principal.url,
        payload: parsed.payload,
        key: parsed.key,
        type: parsed.type,
        mode: parsed.mode,
        position: parsed.position,
      },
      new Date(Date.now() + parsed.afterMs)
    )
  } else {
    await ctx.entityManager.send(entityUrl, {
      from: principal.url,
      payload: parsed.payload,
      key: parsed.key,
      type: parsed.type,
      mode: parsed.mode,
      position: parsed.position,
    })
  }

  return status(204)
}

async function updateInboxMessage(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<InboxMessageBody>(request)
  const { entityUrl } = requireExistingEntityRoute(request)
  await ctx.entityManager.updateInboxMessage(
    entityUrl,
    decodeURIComponent(request.params.messageKey),
    parsed
  )
  return status(204)
}

async function deleteInboxMessage(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const { entityUrl } = requireExistingEntityRoute(request)
  await ctx.entityManager.deleteInboxMessage(
    entityUrl,
    decodeURIComponent(request.params.messageKey)
  )
  return status(204)
}

async function spawnEntity(
  request: AgentsRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<SpawnBody>(request)
  const principal = ctx.principal
  await ctx.entityManager.ensurePrincipal(principal)
  const dispatchPolicy = await resolveEffectiveDispatchPolicyForSpawn(
    ctx,
    request.params.type,
    {
      dispatchPolicy: parsed.dispatch_policy,
      parent: parsed.parent,
    }
  )
  await assertDispatchPolicyAllowed(ctx, dispatchPolicy)
  const entity = await ctx.entityManager.spawn(request.params.type, {
    instance_id: request.params.instanceId,
    args: parsed.args,
    tags: parsed.tags,
    parent: parsed.parent,
    dispatch_policy: dispatchPolicy,
    initialMessage: undefined,
    wake: parsed.wake,
    created_by: principal.url,
  })
  await linkEntityDispatchSubscription(ctx, entity)
  if (parsed.initialMessage !== undefined) {
    await ctx.entityManager.send(entity.url, {
      from: principal.url,
      payload: parsed.initialMessage,
    })
  }

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
  const principalMutationError = rejectPrincipalEntityMutation(
    request,
    `killed`
  )
  if (principalMutationError) return principalMutationError

  const { entityUrl, entity } = requireExistingEntityRoute(request)
  await unlinkEntityDispatchSubscription(ctx, entity)
  const result = await ctx.entityManager.kill(entityUrl)
  ctx.runtime.claimWriteTokens.clearStream(ctx.service, entity.streams.main)
  return json(result)
}
