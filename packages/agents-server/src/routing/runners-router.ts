import { appendPathToUrl } from '@electric-ax/agents-runtime'
import { Type, type Static } from '@sinclair/typebox'
import { Router, json, status } from 'itty-router'
import { consumerCallbacks } from '../db/schema.js'
import { apiError } from '../electric-agents-http.js'
import { ElectricAgentsError } from '../entity-manager.js'
import {
  ErrCodeInvalidRequest,
  ErrCodeNotFound,
  ErrCodeNotRunning,
  ErrCodeUnauthorized,
} from '../electric-agents-types.js'
import { routeBody, withSchema } from './schema.js'
import { subscriptionIdForDispatchTarget } from './dispatch-policy.js'
import { withLeadingSlash } from './tenant-stream-paths.js'
import type { JsonRouteRequest } from './schema.js'
import type { RouterType } from 'itty-router'
import type { TenantContext } from './context.js'
import {
  DurableStreamsSubscriptionError,
  type SubscriptionClaimResponse,
} from '../stream-client.js'

interface RunnersRouteRequest extends JsonRouteRequest {}

type RunnersRouteArgs = [TenantContext]
type RunnersRouteResult = Response | undefined

export type RunnersRoutes = RouterType<
  RunnersRouteRequest,
  RunnersRouteArgs,
  RunnersRouteResult
>

const registerRunnerBodySchema = Type.Object({
  id: Type.String(),
  owner_user_id: Type.Optional(Type.String()),
  label: Type.String(),
  kind: Type.Optional(
    Type.Union([
      Type.Literal(`local`),
      Type.Literal(`cloud-worker`),
      Type.Literal(`sandbox`),
      Type.Literal(`ci`),
      Type.Literal(`server`),
    ])
  ),
  admin_status: Type.Optional(
    Type.Union([Type.Literal(`enabled`), Type.Literal(`disabled`)])
  ),
  wake_stream: Type.Optional(Type.String()),
})

const heartbeatBodySchema = Type.Object({
  lease_ms: Type.Optional(Type.Number()),
  wake_stream_offset: Type.Optional(Type.String()),
  wakeStreamOffset: Type.Optional(Type.String()),
  liveness_lease_expires_at: Type.Optional(Type.String()),
})

const claimBodySchema = Type.Object(
  {
    subscription_id: Type.Optional(Type.String()),
    stream: Type.Optional(Type.String()),
    generation: Type.Optional(Type.Number()),
    ts: Type.Optional(Type.Union([Type.String(), Type.Number()])),
  },
  { additionalProperties: true }
)

type RegisterRunnerBody = Static<typeof registerRunnerBodySchema>
type HeartbeatBody = Static<typeof heartbeatBodySchema>
type ClaimBody = Static<typeof claimBodySchema>

export const runnersRouter: RunnersRoutes = Router<
  RunnersRouteRequest,
  RunnersRouteArgs,
  RunnersRouteResult
>({
  base: `/_electric/runners`,
})

runnersRouter.post(`/`, withSchema(registerRunnerBodySchema), registerRunner)
runnersRouter.get(`/`, listRunners)
runnersRouter.get(`/:id`, getRunner)
runnersRouter.post(`/:id/heartbeat`, withSchema(heartbeatBodySchema), heartbeat)
runnersRouter.post(`/:id/enable`, setEnabled)
runnersRouter.post(`/:id/disable`, setDisabled)
runnersRouter.post(`/:id/claim`, withSchema(claimBodySchema), claimWake)

function routeParam(request: RunnersRouteRequest, name: string): string {
  const value = request.params[name]
  return decodeURIComponent(Array.isArray(value) ? value[0]! : value)
}

function firstQueryValue(
  value: string | Array<string> | undefined
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

async function registerRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<RegisterRunnerBody>(request)
  const ownerUserId = parsed.owner_user_id ?? ctx.authenticatedUser?.userId
  if (!ownerUserId) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_user_id is required when no authenticated user is present`,
      400
    )
  }
  if (ctx.authenticatedUser && ownerUserId !== ctx.authenticatedUser.userId) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_user_id must match the authenticated user`,
      403
    )
  }

  const runner = await ctx.entityManager.registry.createRunner({
    id: parsed.id,
    ownerUserId,
    label: parsed.label,
    kind: parsed.kind,
    adminStatus: parsed.admin_status,
    wakeStream: parsed.wake_stream,
  })
  await ctx.streamClient.ensure(runner.wake_stream, {
    contentType: `application/json`,
  })
  return json(runner, { status: 201 })
}

async function listRunners(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const requestedOwner = firstQueryValue(request.query.owner_user_id)
  if (
    ctx.authenticatedUser &&
    requestedOwner &&
    requestedOwner !== ctx.authenticatedUser.userId
  ) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_user_id must match the authenticated user`,
      403
    )
  }
  const runners = await ctx.entityManager.registry.listRunners({
    ownerUserId: ctx.authenticatedUser?.userId ?? requestedOwner,
  })
  return json(runners)
}

async function getRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runner = await requireRunner(ctx, routeParam(request, `id`))
  assertRunnerOwnerIfAuthenticated(ctx, runner.owner_user_id)
  return json(runner)
}

async function heartbeat(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  const existing = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, existing.owner_user_id)
  const parsed = routeBody<HeartbeatBody>(request)
  const runner = await ctx.entityManager.registry.heartbeatRunner({
    runnerId,
    leaseMs: parsed.lease_ms,
    wakeStreamOffset: parsed.wake_stream_offset ?? parsed.wakeStreamOffset,
    livenessLeaseExpiresAt: parsed.liveness_lease_expires_at
      ? new Date(parsed.liveness_lease_expires_at)
      : undefined,
  })
  if (!runner) {
    throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404)
  }
  return json(runner)
}

async function setEnabled(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  return await setRunnerStatus(request, ctx, `enabled`)
}

async function setDisabled(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  return await setRunnerStatus(request, ctx, `disabled`)
}

async function setRunnerStatus(
  request: RunnersRouteRequest,
  ctx: TenantContext,
  adminStatus: `enabled` | `disabled`
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  const existing = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, existing.owner_user_id)
  const runner = await ctx.entityManager.registry.setRunnerAdminStatus(
    runnerId,
    adminStatus
  )
  if (!runner) {
    throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404)
  }
  return json(runner)
}

async function claimWake(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  if (!ctx.authenticatedUser) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `Authentication is required to claim runner work`,
      401
    )
  }
  const runner = await requireRunner(ctx, runnerId)
  if (runner.owner_user_id !== ctx.authenticatedUser.userId) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `Runner claim requires the authenticated owner`,
      403
    )
  }
  if (runner.admin_status !== `enabled`) {
    throw new ElectricAgentsError(ErrCodeNotRunning, `Runner is disabled`, 409)
  }

  const parsed = routeBody<ClaimBody>(request)
  const expectedSubscriptionId = subscriptionIdForDispatchTarget({
    type: `runner`,
    runnerId,
  })
  const subscriptionId = parsed.subscription_id ?? expectedSubscriptionId
  if (
    subscriptionId !== expectedSubscriptionId &&
    !subscriptionId.startsWith(`${expectedSubscriptionId}:`)
  ) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Wake event subscription_id does not match runner`,
      400
    )
  }

  const claim = await ctx.streamClient
    .claimSubscription(subscriptionId, runnerId)
    .catch((err) => {
      if (isExpectedClaimConflict(err)) {
        return err
      }
      throw err
    })
  if (claim instanceof DurableStreamsSubscriptionError) {
    return apiError(
      claim.status,
      claim.code ?? `SUBSCRIPTION_CLAIM_FAILED`,
      claim.errorMessage ?? claim.body
    )
  }
  if (!claim) return status(204)

  const notification = await notificationFromClaim(ctx, {
    runnerId,
    runnerWakeStream: runner.wake_stream,
    subscriptionId,
    claim,
  })
  return json(notification)
}

function isExpectedClaimConflict(
  err: unknown
): err is DurableStreamsSubscriptionError {
  return (
    err instanceof DurableStreamsSubscriptionError &&
    err.status === 409 &&
    (err.code === `NO_PENDING_WORK` || err.code === `ALREADY_CLAIMED`)
  )
}

async function requireRunner(ctx: TenantContext, runnerId: string) {
  const runner = await ctx.entityManager.registry.getRunner(runnerId)
  if (!runner) {
    throw new ElectricAgentsError(ErrCodeNotFound, `Runner not found`, 404)
  }
  return runner
}

function assertRunnerOwnerIfAuthenticated(
  ctx: TenantContext,
  ownerUserId: string
): void {
  if (!ctx.authenticatedUser) return
  if (ownerUserId === ctx.authenticatedUser.userId) return
  throw new ElectricAgentsError(
    ErrCodeUnauthorized,
    `Runner access requires the authenticated owner`,
    403
  )
}

async function notificationFromClaim(
  ctx: TenantContext,
  input: {
    runnerId: string
    runnerWakeStream: string
    subscriptionId: string
    claim: SubscriptionClaimResponse
  }
): Promise<Record<string, unknown>> {
  const primary =
    input.claim.streams.find((stream) => stream.has_pending === true) ??
    input.claim.streams[0]
  if (!primary?.path) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Claim response did not include a stream`,
      502
    )
  }

  const primaryStream = withLeadingSlash(primary.path)
  const entity =
    await ctx.entityManager.registry.getEntityByStream(primaryStream)
  if (!entity) {
    throw new ElectricAgentsError(
      ErrCodeNotFound,
      `Claim stream is not attached to an entity`,
      404
    )
  }
  if (entity.status === `stopped`) {
    await ctx.streamClient.releaseSubscription(
      input.subscriptionId,
      input.claim.token,
      {
        wake_id: input.claim.wake_id,
        generation: input.claim.generation,
      }
    )
    return { done: true }
  }

  await ctx.pgDb
    .insert(consumerCallbacks)
    .values({
      tenantId: ctx.service,
      consumerId: input.claim.wake_id,
      callbackUrl: `ds-subscription:${input.subscriptionId}`,
      primaryStream,
    })
    .onConflictDoUpdate({
      target: [consumerCallbacks.tenantId, consumerCallbacks.consumerId],
      set: {
        callbackUrl: `ds-subscription:${input.subscriptionId}`,
        primaryStream,
      },
    })

  await ctx.entityManager.registry.materializeActiveClaim({
    consumerId: input.claim.wake_id,
    epoch: input.claim.generation,
    wakeId: input.claim.wake_id,
    entityUrl: entity.url,
    streamPath: primaryStream,
    runnerId: input.runnerId,
    leaseExpiresAt: input.claim.lease_ttl_ms
      ? new Date(Date.now() + input.claim.lease_ttl_ms)
      : undefined,
  })
  await ctx.entityManager.registry.updateStatus(entity.url, `running`)

  const streams = input.claim.streams.map((stream) => ({
    path: withLeadingSlash(stream.path),
    offset: stream.tail_offset ?? ``,
  }))
  return {
    consumerId: input.claim.wake_id,
    epoch: input.claim.generation,
    wakeId: input.claim.wake_id,
    streamPath: primaryStream,
    streams,
    callback: appendPathToUrl(
      ctx.publicUrl,
      `/_electric/callback-forward/${encodeURIComponent(input.claim.wake_id)}`
    ),
    claimToken: input.claim.token,
    triggerEvent: `message_received`,
    entity: {
      type: entity.type,
      status: entity.status,
      url: entity.url,
      streams: entity.streams,
      tags: entity.tags,
      spawnArgs: entity.spawn_args,
    },
  }
}
