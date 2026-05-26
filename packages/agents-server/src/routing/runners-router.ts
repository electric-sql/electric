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
  type RunnerHealthResponse,
} from '../electric-agents-types.js'
import { routeBody, withSchema } from './schema.js'
import { subscriptionIdForDispatchTarget } from './dispatch-policy.js'
import { withLeadingSlash } from './tenant-stream-paths.js'
import { parsePrincipalUrl, principalFromCreatedBy } from '../principal.js'
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

const sandboxProfileBodySchema = Type.Object({
  name: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
  remote: Type.Optional(Type.Boolean()),
})

const registerRunnerBodySchema = Type.Object({
  id: Type.String(),
  owner_principal: Type.Optional(Type.String()),
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
  sandbox_profiles: Type.Optional(Type.Array(sandboxProfileBodySchema)),
})

const heartbeatBodySchema = Type.Object({
  lease_ms: Type.Optional(Type.Number()),
  wake_stream_offset: Type.Optional(Type.String()),
  wakeStreamOffset: Type.Optional(Type.String()),
  liveness_lease_expires_at: Type.Optional(Type.String()),
  diagnostics: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
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
type RunnerClientDiagnostics = NonNullable<RunnerHealthResponse[`client`]>

const runnerClientStatuses = new Set<RunnerClientDiagnostics[`status`]>([
  `stopped`,
  `starting`,
  `connecting`,
  `streaming`,
  `reconnecting`,
  `stopping`,
])
const runnerLastClaimResults = new Set<
  NonNullable<RunnerClientDiagnostics[`last_claim_result`]>
>([`claimed`, `no_work`, `error`])
const runnerStringOrNullDiagnostics = [
  `started_at`,
  `stream_connected_since`,
  `last_error`,
  `last_error_at`,
  `last_heartbeat_at`,
  `last_claim_at`,
  `last_dispatch_at`,
] as const
const runnerNumberDiagnostics = [
  `reconnect_count`,
  `events_received`,
  `claims_succeeded`,
  `claims_skipped`,
  `claims_failed`,
] as const

export const runnersRouter: RunnersRoutes = Router<
  RunnersRouteRequest,
  RunnersRouteArgs,
  RunnersRouteResult
>({
  base: `/_electric/runners`,
})

runnersRouter.post(`/`, withSchema(registerRunnerBodySchema), registerRunner)
runnersRouter.get(`/`, listRunners)
runnersRouter.get(`/:id/health`, runnerHealth)
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

function requireAuthenticatedPrincipal(
  ctx: TenantContext
): NonNullable<TenantContext[`principal`]> {
  if (ctx.principal) return ctx.principal
  throw new ElectricAgentsError(
    ErrCodeUnauthorized,
    `Runner route requires an authenticated principal`,
    401
  )
}

function canonicalOwnerPrincipal(input: string): string | null {
  return parsePrincipalUrl(input)?.url ?? null
}

function sanitizeRunnerDiagnostics(
  diagnostics: Record<string, unknown> | null | undefined
): RunnerClientDiagnostics | undefined {
  if (!diagnostics) return undefined
  const sanitized: Record<string, unknown> = {}

  if (
    typeof diagnostics.status === `string` &&
    runnerClientStatuses.has(
      diagnostics.status as RunnerClientDiagnostics[`status`]
    )
  ) {
    sanitized.status = diagnostics.status
  }
  if (typeof diagnostics.stream_connected === `boolean`) {
    sanitized.stream_connected = diagnostics.stream_connected
  }
  if (typeof diagnostics.last_heartbeat_ok === `boolean`) {
    sanitized.last_heartbeat_ok = diagnostics.last_heartbeat_ok
  }
  if (
    diagnostics.last_claim_result === null ||
    (typeof diagnostics.last_claim_result === `string` &&
      runnerLastClaimResults.has(
        diagnostics.last_claim_result as NonNullable<
          RunnerClientDiagnostics[`last_claim_result`]
        >
      ))
  ) {
    sanitized.last_claim_result = diagnostics.last_claim_result
  }

  for (const key of runnerStringOrNullDiagnostics) {
    const value = diagnostics[key]
    if (typeof value === `string` || value === null) {
      sanitized[key] = value
    }
  }
  for (const key of runnerNumberDiagnostics) {
    const value = diagnostics[key]
    if (typeof value === `number` && Number.isFinite(value) && value >= 0) {
      sanitized[key] = value
    }
  }

  return Object.keys(sanitized).length > 0
    ? (sanitized as RunnerClientDiagnostics)
    : undefined
}

async function registerRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const parsed = routeBody<RegisterRunnerBody>(request)
  const principal = requireAuthenticatedPrincipal(ctx)
  const ownerPrincipal = parsed.owner_principal ?? principal.url
  if (!ownerPrincipal) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal is required when no authenticated principal is present`,
      400
    )
  }
  const canonicalOwner = canonicalOwnerPrincipal(ownerPrincipal)
  if (!canonicalOwner) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal must be a valid principal URL (e.g. /principal/user%3Aalice), got: ${ownerPrincipal}`,
      400
    )
  }
  if (canonicalOwner !== principal.url) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_principal must match the authenticated principal`,
      403
    )
  }

  const runner = await ctx.entityManager.registry.createRunner({
    id: parsed.id,
    ownerPrincipal: canonicalOwner,
    label: parsed.label,
    kind: parsed.kind,
    adminStatus: parsed.admin_status,
    wakeStream: parsed.wake_stream,
    sandboxProfiles: parsed.sandbox_profiles,
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
  const principal = requireAuthenticatedPrincipal(ctx)
  const requestedOwner = firstQueryValue(request.query.owner_principal)
  const canonicalRequestedOwner = requestedOwner
    ? canonicalOwnerPrincipal(requestedOwner)
    : undefined
  if (requestedOwner && !canonicalRequestedOwner) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `owner_principal must be a valid principal URL (e.g. /principal/user%3Aalice), got: ${requestedOwner}`,
      400
    )
  }
  if (canonicalRequestedOwner && canonicalRequestedOwner !== principal.url) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `owner_principal must match the authenticated principal`,
      403
    )
  }
  const runners = await ctx.entityManager.registry.listRunners({
    ownerPrincipal: principal.url,
  })
  return json(runners)
}

async function getRunner(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runner = await requireRunner(ctx, routeParam(request, `id`))
  assertRunnerOwnerIfAuthenticated(ctx, runner.owner_principal)
  return json(runner)
}

async function heartbeat(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  requireAuthenticatedPrincipal(ctx)
  const existing = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, existing.owner_principal)
  const parsed = routeBody<HeartbeatBody>(request)
  const runner = await ctx.entityManager.registry.heartbeatRunner({
    runnerId,
    ownerPrincipal: existing.owner_principal,
    leaseMs: parsed.lease_ms,
    wakeStreamOffset: parsed.wake_stream_offset ?? parsed.wakeStreamOffset,
    livenessLeaseExpiresAt: parsed.liveness_lease_expires_at
      ? new Date(parsed.liveness_lease_expires_at)
      : undefined,
    diagnostics: sanitizeRunnerDiagnostics(parsed.diagnostics),
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
  requireAuthenticatedPrincipal(ctx)
  const existing = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, existing.owner_principal)
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
  const principal = requireAuthenticatedPrincipal(ctx)
  const runner = await requireRunner(ctx, runnerId)
  if (runner.owner_principal !== principal.url) {
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
  ownerPrincipal: string
): void {
  requireAuthenticatedPrincipal(ctx)
  if (ownerPrincipal === ctx.principal.url) return
  throw new ElectricAgentsError(
    ErrCodeUnauthorized,
    `Runner access requires the authenticated owner`,
    403
  )
}

async function runnerHealth(
  request: RunnersRouteRequest,
  ctx: TenantContext
): Promise<Response> {
  const runnerId = routeParam(request, `id`)
  const runner = await requireRunner(ctx, runnerId)
  assertRunnerOwnerIfAuthenticated(ctx, runner.owner_principal)
  const runtimeDiagnostics =
    await ctx.entityManager.registry.getRunnerDiagnostics(runnerId)

  const now = Date.now()
  const parsedLeaseExpiresAt = runtimeDiagnostics?.liveness_lease_expires_at
    ? new Date(runtimeDiagnostics.liveness_lease_expires_at).getTime()
    : null
  const leaseExpiresAt =
    parsedLeaseExpiresAt !== null && Number.isFinite(parsedLeaseExpiresAt)
      ? parsedLeaseExpiresAt
      : null

  let livenessStatus: `online` | `offline` | `expired`
  if (runner.admin_status === `disabled`) {
    livenessStatus = `offline`
  } else if (leaseExpiresAt !== null && leaseExpiresAt > now) {
    livenessStatus = `online`
  } else if (leaseExpiresAt !== null) {
    livenessStatus = `expired`
  } else {
    livenessStatus = `offline`
  }

  const [activeClaims, dispatchStats] = await Promise.all([
    ctx.entityManager.registry.getActiveClaimsForRunner(runnerId),
    ctx.entityManager.registry.getDispatchStatsForRunner(runnerId),
  ])

  const clientDiagnostics =
    sanitizeRunnerDiagnostics(runtimeDiagnostics?.diagnostics) ?? null
  const issues: Array<string> = []
  let healthStatus: `healthy` | `degraded` | `unhealthy` = `healthy`

  const escalate = (floor: `degraded` | `unhealthy`): void => {
    if (floor === `unhealthy`) healthStatus = `unhealthy`
    else if (healthStatus === `healthy`) healthStatus = `degraded`
  }

  if (runner.admin_status === `disabled`) {
    escalate(`unhealthy`)
    issues.push(`Runner is disabled`)
  }
  if (livenessStatus === `expired`) {
    escalate(`unhealthy`)
    const ago = leaseExpiresAt ? Math.round((now - leaseExpiresAt) / 1000) : 0
    issues.push(`Heartbeat lease expired ${ago}s ago`)
  }
  if (livenessStatus === `offline` && runner.admin_status === `enabled`) {
    escalate(`degraded`)
    issues.push(`Runner has never sent a heartbeat`)
  }
  if (clientDiagnostics) {
    if (clientDiagnostics.stream_connected === false) {
      escalate(`degraded`)
      issues.push(`Client reports stream disconnected`)
    }
    if (clientDiagnostics.last_heartbeat_ok === false) {
      escalate(`degraded`)
      issues.push(`Client reports last heartbeat failed`)
    }
    if (
      typeof clientDiagnostics.reconnect_count === `number` &&
      clientDiagnostics.reconnect_count > 5
    ) {
      escalate(`degraded`)
      issues.push(
        `Client has reconnected ${clientDiagnostics.reconnect_count} times`
      )
    }
  } else if (runtimeDiagnostics?.last_seen_at) {
    escalate(`degraded`)
    issues.push(`No client diagnostics available`)
  }

  const body: RunnerHealthResponse = {
    runner: {
      id: runner.id,
      admin_status: runner.admin_status,
      liveness_status: livenessStatus,
      lease_expires_at:
        leaseExpiresAt !== null
          ? (runtimeDiagnostics?.liveness_lease_expires_at ?? null)
          : null,
      lease_remaining_ms:
        leaseExpiresAt !== null ? Math.max(0, leaseExpiresAt - now) : null,
      wake_stream: runner.wake_stream,
      wake_stream_offset: runtimeDiagnostics?.wake_stream_offset ?? null,
      last_seen_at: runtimeDiagnostics?.last_seen_at ?? null,
      created_at: runner.created_at,
    },
    client: clientDiagnostics,
    claims: {
      active_count: activeClaims.length,
      active: activeClaims.map((c) => ({
        consumer_id: c.consumer_id,
        epoch: c.epoch,
        entity_url: c.entity_url,
        stream_path: c.stream_path,
        claimed_at: c.claimed_at,
        last_heartbeat_at: c.last_heartbeat_at ?? null,
        lease_expires_at: c.lease_expires_at ?? null,
      })),
    },
    dispatch: dispatchStats,
    health: { status: healthStatus, issues },
  }
  return json(body)
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
  if (entity.status === `stopped` || entity.status === `paused`) {
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
      `/_electric/wake-callbacks/${encodeURIComponent(input.claim.wake_id)}`
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
      sandbox: entity.sandbox,
      createdBy: entity.created_by,
    },
    principal: principalFromCreatedBy(entity.created_by),
  }
}
