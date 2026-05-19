import { createHash } from 'node:crypto'
import { appendPathToUrl } from '@electric-ax/agents-runtime'
import { subscriptionWebhooks } from '../db/schema.js'
import { ElectricAgentsError } from '../entity-manager.js'
import {
  ErrCodeInvalidRequest,
  ErrCodeNotFound,
  ErrCodeUnauthorized,
} from '../electric-agents-types.js'
import { runnerWakeStream } from '../entity-registry.js'
import { DurableStreamsSubscriptionError } from '../stream-client.js'
import { rewriteLoopbackWebhookUrl } from '../utils/webhook-url.js'
import { serverLog } from '../utils/log.js'
import type {
  DispatchPolicy,
  DispatchTarget,
  ElectricAgentsEntity,
} from '../electric-agents-types.js'
import type { TenantContext } from './context.js'
import type { SubscriptionCreateInput } from '../stream-client.js'

const linkedDispatchSubscriptions = new WeakMap<object, Set<string>>()

export function subscriptionIdForDispatchTarget(
  target: DispatchTarget
): string {
  if (target.subscription_id) return target.subscription_id
  if (target.type === `runner`) return `runner:${target.runnerId}`
  const digest = createHash(`sha256`).update(target.url).digest(`hex`)
  return `webhook:${digest.slice(0, 16)}`
}

function subscriptionIdForEntityDispatchTarget(
  target: DispatchTarget,
  entityUrl: string
): string {
  const base = subscriptionIdForDispatchTarget(target)
  if (!target.subscription_id && target.type !== `runner`) return base
  const digest = createHash(`sha256`).update(entityUrl).digest(`hex`)
  return `${base}:${digest.slice(0, 16)}`
}

export async function resolveEffectiveDispatchPolicyForSpawn(
  ctx: TenantContext,
  typeName: string,
  opts: { dispatchPolicy?: DispatchPolicy; parent?: string }
): Promise<DispatchPolicy | undefined> {
  if (opts.dispatchPolicy) return opts.dispatchPolicy
  const entityType = await ctx.entityManager.registry.getEntityType(typeName)
  if (opts.parent) {
    const parent = await ctx.entityManager.registry.getEntity(opts.parent)
    if (parent?.dispatch_policy) {
      return applyTypeDefaultSubscriptionScope(
        parent.dispatch_policy,
        entityType?.default_dispatch_policy
      )
    }
  }
  return entityType?.default_dispatch_policy
}

export async function resolveEffectiveDispatchPolicyForEntity(
  ctx: TenantContext,
  entity: ElectricAgentsEntity
): Promise<DispatchPolicy | undefined> {
  if (entity.dispatch_policy) return entity.dispatch_policy
  const entityType = await ctx.entityManager.registry.getEntityType(entity.type)
  return entityType?.default_dispatch_policy
}

export async function backfillEntityDispatchPolicy(
  ctx: TenantContext,
  entity: ElectricAgentsEntity
): Promise<ElectricAgentsEntity> {
  if (entity.dispatch_policy) return entity
  const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(
    ctx,
    entity
  )
  if (!dispatchPolicy) return entity
  return (
    (await ctx.entityManager.registry.updateEntityDispatchPolicy(
      entity.url,
      dispatchPolicy
    )) ?? { ...entity, dispatch_policy: dispatchPolicy }
  )
}

export function applyTypeDefaultSubscriptionScope(
  policy: DispatchPolicy,
  typeDefault: DispatchPolicy | undefined
): DispatchPolicy {
  const target = policy.targets[0]
  const defaultTarget = typeDefault?.targets[0]
  if (!target || !defaultTarget?.subscription_id) return policy
  if (!sameDispatchDestination(target, defaultTarget)) return policy
  if (target.subscription_id === defaultTarget.subscription_id) return policy

  return {
    targets: [{ ...target, subscription_id: defaultTarget.subscription_id }],
  }
}

function sameDispatchDestination(
  a: DispatchTarget,
  b: DispatchTarget
): boolean {
  if (a.type !== b.type) return false
  if (a.type === `runner` && b.type === `runner`) {
    return a.runnerId === b.runnerId
  }
  if (a.type === `webhook` && b.type === `webhook`) return a.url === b.url
  return false
}

function subscriptionHasStream(
  ctx: TenantContext,
  existing: { streams?: Array<string | { path?: string }> },
  streamPath: string
): boolean {
  const normalizedStream = streamPath.replace(/^\/+/, ``)
  // Defence-in-depth: `StreamClient.subscriptionResponseBody` already maps
  // server-returned paths back to the runtime namespace when an adapter is
  // configured, so `existing.streams` should be runtime-namespaced. The
  // backend-namespace comparison below catches cases where the response did
  // not pass through the adapter (custom `streamClient`, older deployments,
  // etc.) and also makes the intent of the comparison explicit.
  const backendStream =
    ctx.durableStreamsRouting?.toBackendStreamPath(
      ctx.service,
      normalizedStream
    ) ?? normalizedStream
  return (
    existing.streams?.some((stream) => {
      const path = typeof stream === `string` ? stream : stream.path
      if (!path) return false
      const normalized = path.replace(/^\/+/, ``)
      return normalized === normalizedStream || normalized === backendStream
    }) ?? false
  )
}

function dispatchLinkCacheKey(
  ctx: TenantContext,
  subscriptionId: string,
  streamPath: string
): string {
  return `${ctx.service}:${subscriptionId}:${streamPath}`
}

function getDispatchLinkCache(ctx: TenantContext): Set<string> {
  let cache = linkedDispatchSubscriptions.get(ctx.streamClient)
  if (!cache) {
    cache = new Set()
    linkedDispatchSubscriptions.set(ctx.streamClient, cache)
  }
  return cache
}

function isSubscriptionAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof DurableStreamsSubscriptionError)) return false
  if (err.status === 409) return true
  return (
    err.code === `SUBSCRIPTION_ALREADY_EXISTS` ||
    err.code === `ALREADY_EXISTS` ||
    /already exists/i.test(err.errorMessage ?? err.body ?? err.message)
  )
}

async function ensureSubscriptionIncludesStream(
  ctx: TenantContext,
  subscriptionId: string,
  streamPath: string,
  input: SubscriptionCreateInput,
  existing: { streams?: Array<string | { path?: string }> } | null
): Promise<void> {
  if (!existing) {
    try {
      await ctx.streamClient.putSubscription(subscriptionId, input)
      return
    } catch (err) {
      if (!isSubscriptionAlreadyExistsError(err)) throw err
      existing = await ctx.streamClient.getSubscription(subscriptionId)
      if (!existing) {
        serverLog.warn(
          `[dispatch-policy] subscription create raced with existing subscription but it could not be read`,
          { subscriptionId, stream: streamPath }
        )
        return
      }
    }
  }

  if (!subscriptionHasStream(ctx, existing, streamPath)) {
    await ctx.streamClient.addSubscriptionStreams(subscriptionId, [streamPath])
  }
}

export async function assertDispatchPolicyAllowed(
  ctx: TenantContext,
  policy: DispatchPolicy | undefined
): Promise<void> {
  const target = policy?.targets[0]
  if (!target || target.type !== `runner`) return
  if (!ctx.principal) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `Runner dispatch requires an authenticated owner`,
      401
    )
  }

  const runner = await ctx.entityManager.registry.getRunner(target.runnerId)
  if (!runner) {
    throw new ElectricAgentsError(
      ErrCodeNotFound,
      `Runner "${target.runnerId}" not found`,
      404
    )
  }
  if (runner.owner_principal !== ctx.principal.url) {
    throw new ElectricAgentsError(
      ErrCodeUnauthorized,
      `Runner dispatch requires the authenticated owner`,
      403
    )
  }
}

export async function linkEntityDispatchSubscription(
  ctx: TenantContext,
  entity: ElectricAgentsEntity
): Promise<void> {
  const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(
    ctx,
    entity
  )
  const target = dispatchPolicy?.targets[0]
  if (!target) return
  const subscriptionId = subscriptionIdForEntityDispatchTarget(
    target,
    entity.url
  )
  const cacheKey = dispatchLinkCacheKey(
    ctx,
    subscriptionId,
    entity.streams.main
  )
  const cache = getDispatchLinkCache(ctx)
  if (cache.has(cacheKey)) return
  await linkStreamToTargetSubscription(ctx, target, entity, subscriptionId)
  cache.add(cacheKey)
}

export async function unlinkEntityDispatchSubscription(
  ctx: TenantContext,
  entity: ElectricAgentsEntity
): Promise<void> {
  const dispatchPolicy = await resolveEffectiveDispatchPolicyForEntity(
    ctx,
    entity
  )
  const target = dispatchPolicy?.targets[0]
  if (!target) return
  const subscriptionId = subscriptionIdForEntityDispatchTarget(
    target,
    entity.url
  )
  getDispatchLinkCache(ctx).delete(
    dispatchLinkCacheKey(ctx, subscriptionId, entity.streams.main)
  )
  await ctx.streamClient
    .removeSubscriptionStream(subscriptionId, entity.streams.main)
    .catch((err) => {
      serverLog.warn(
        `[dispatch-policy] failed to remove stream from subscription`,
        { subscriptionId, stream: entity.streams.main },
        err
      )
    })
}

async function linkStreamToTargetSubscription(
  ctx: TenantContext,
  target: DispatchTarget,
  entity: ElectricAgentsEntity,
  subscriptionId: string
): Promise<void> {
  const streamPath = entity.streams.main
  await ctx.streamClient.ensure(streamPath, {
    contentType: `application/json`,
  })
  const existing = await ctx.streamClient.getSubscription(subscriptionId)

  if (target.type === `runner`) {
    const runner = await ctx.entityManager.registry.getRunner(target.runnerId)
    if (!runner) {
      throw new ElectricAgentsError(
        ErrCodeNotFound,
        `Runner "${target.runnerId}" not found`,
        404
      )
    }
    const wakeStream = runner.wake_stream || runnerWakeStream(target.runnerId)
    await ctx.streamClient.ensure(wakeStream, {
      contentType: `application/json`,
    })
    await ensureSubscriptionIncludesStream(
      ctx,
      subscriptionId,
      streamPath,
      {
        type: `pull-wake`,
        streams: [streamPath],
        wake_stream: wakeStream,
        description: `Electric Agents runner ${target.runnerId}`,
      },
      existing
    )
    return
  }

  const webhookUrl = rewriteLoopbackWebhookUrl(target.url)
  if (!webhookUrl) {
    throw new ElectricAgentsError(
      ErrCodeInvalidRequest,
      `Webhook dispatch target must include a valid URL`,
      400
    )
  }
  const forwardUrl = appendPathToUrl(
    ctx.publicUrl,
    `/_electric/webhook-forward/${encodeURIComponent(subscriptionId)}`
  )
  await ensureSubscriptionIncludesStream(
    ctx,
    subscriptionId,
    streamPath,
    {
      type: `webhook`,
      streams: [streamPath],
      webhook: { url: forwardUrl },
      description: `Electric Agents webhook ${subscriptionId}`,
    },
    existing
  )
  await ctx.pgDb
    .insert(subscriptionWebhooks)
    .values({
      tenantId: ctx.service,
      subscriptionId,
      webhookUrl,
    })
    .onConflictDoUpdate({
      target: [
        subscriptionWebhooks.tenantId,
        subscriptionWebhooks.subscriptionId,
      ],
      set: { webhookUrl },
    })
}
