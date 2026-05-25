/**
 * Sub-router for /_electric/* control-plane routes.
 */

import {
  appendPathToUrl,
  verifyWebhookSignature,
} from '@electric-ax/agents-runtime'
import { Type, type Static } from '@sinclair/typebox'
import { and, eq } from 'drizzle-orm'
import { Router, json, status } from 'itty-router'
import {
  apiError,
  readRequestBody,
  responseHeaders,
} from '../electric-agents-http.js'
import { consumerCallbacks, subscriptionWebhooks } from '../db/schema.js'
import {
  ErrCodeCallbackNotFound,
  ErrCodeForkInProgress,
  ErrCodeSubscriptionNotFound,
  ErrCodeUnauthorized,
} from '../electric-agents-types.js'
import { ATTR, tracer } from '../tracing.js'
import { decodeJsonObject } from '../utils/server-utils.js'
import { serverLog } from '../utils/log.js'
import { applyDurableStreamsBearer } from '../stream-client.js'
import { getDefaultWebhookSigner } from '../webhook-signing.js'
import { cronRouter } from './cron-router.js'
import { resolveDurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import { electricProxyRouter } from './electric-proxy-router.js'
import { entitiesRouter } from './entities-router.js'
import { entityTypesRouter } from './entity-types-router.js'
import { getRequestSpan } from './hooks.js'
import { runnersRouter } from './runners-router.js'
import { routeBody, validateOptionalJsonBody, withSchema } from './schema.js'
import { withLeadingSlash } from './tenant-stream-paths.js'
import type { IRequest, RouterType } from 'itty-router'
import type {
  EventSourceContract,
  WebhookSignatureVerifierConfig,
} from '@electric-ax/agents-runtime'
import type { TenantContext } from './context.js'
import type { DurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { WebhookSigner } from '../webhook-signing.js'

const wakeRegistrationBodySchema = Type.Object({
  subscriberUrl: Type.String(),
  sourceUrl: Type.String(),
  condition: Type.Union([
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
  ]),
  debounceMs: Type.Optional(Type.Number()),
  timeoutMs: Type.Optional(Type.Number()),
  includeResponse: Type.Optional(Type.Boolean()),
  manifestKey: Type.Optional(Type.String()),
})

const webhookForwardBodySchema = Type.Object(
  {
    subscription_id: Type.Optional(Type.String()),
    wake_id: Type.Optional(Type.String()),
    generation: Type.Optional(Type.Number()),
    streams: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
    callback_url: Type.Optional(Type.String()),
    callback_token: Type.Optional(Type.String()),
    primary_stream: Type.Optional(Type.String()),
    primaryStream: Type.Optional(Type.String()),
    streamPath: Type.Optional(Type.String()),
    consumerId: Type.Optional(Type.String()),
    consumer_id: Type.Optional(Type.String()),
    callback: Type.Optional(Type.String()),
  },
  { additionalProperties: true }
)

const callbackForwardBodySchema = Type.Object(
  {
    epoch: Type.Optional(Type.Number()),
    generation: Type.Optional(Type.Number()),
    wakeId: Type.Optional(Type.String()),
    wake_id: Type.Optional(Type.String()),
    acks: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
    done: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true }
)

type WakeRegistrationBody = Static<typeof wakeRegistrationBodySchema>
type WebhookForwardBody = Static<typeof webhookForwardBodySchema>
type CallbackForwardBody = Static<typeof callbackForwardBodySchema>

const DS_SUBSCRIPTION_CALLBACK_PREFIX = `ds-subscription:`

export type InternalRoutes = RouterType<
  IRequest,
  [TenantContext],
  Response | undefined
>

export const internalRouter: InternalRoutes = Router<
  IRequest,
  [TenantContext],
  Response | undefined
>({
  base: `/_electric`,
})

internalRouter.get(`/health`, () => json({ status: `ok` }))
internalRouter.get(`/event-sources`, listEventSources)
internalRouter.post(
  `/wake`,
  withSchema(wakeRegistrationBodySchema),
  registerWake
)
internalRouter.post(`/webhook-forward/:subscriptionId`, webhookForward)
internalRouter.post(`/callback-forward/:consumerId`, callbackForward)
internalRouter.all(`/runners`, runnersRouter.fetch)
internalRouter.all(`/runners/*`, runnersRouter.fetch)
internalRouter.all(`/entities/*`, entitiesRouter.fetch)
internalRouter.all(`/entity-types/*`, entityTypesRouter.fetch)
internalRouter.all(`/cron/*`, cronRouter.fetch)
internalRouter.get(`/electric/*`, electricProxyRouter.fetch)
internalRouter.all(`*`, () => status(404))

function routeParam(request: IRequest, name: string): string {
  const value = request.params[name]
  return decodeURIComponent(Array.isArray(value) ? value[0]! : value)
}

function bodyFromBytes(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  ) as ArrayBuffer
}

function responseFromUpstream(response: Response, body?: Uint8Array): Response {
  const responseBody = forbidsResponseBody(response.status)
    ? null
    : body !== undefined
      ? bodyFromBytes(body)
      : response.body
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  })
}

function forbidsResponseBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

function forwardHeadersFromRequest(request: IRequest): Headers {
  const headers = new Headers(request.headers)
  headers.delete(`host`)
  return headers
}

function durableStreamsSubscriptionCallback(value: string): string | null {
  return value.startsWith(DS_SUBSCRIPTION_CALLBACK_PREFIX)
    ? value.slice(DS_SUBSCRIPTION_CALLBACK_PREFIX.length)
    : null
}

function resolveWebhookSigner(ctx: TenantContext): WebhookSigner {
  return ctx.webhookSigner ?? getDefaultWebhookSigner()
}

function durableStreamsWebhookJwksUrl(ctx: TenantContext): string {
  if (!ctx.durableStreamsRouting) {
    return appendPathToUrl(ctx.durableStreamsUrl, `/__ds/jwks.json`)
  }

  return resolveDurableStreamsRoutingAdapter(
    ctx.durableStreamsRouting,
    ctx.durableStreamsUrl
  )
    .controlUrl({
      durableStreamsUrl: ctx.durableStreamsUrl,
      serviceId: ctx.service,
      requestUrl: appendPathToUrl(ctx.publicUrl, `/__ds/jwks.json`),
    })
    .toString()
}

function durableStreamsJwksFetchClient(ctx: TenantContext): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers)
    await applyDurableStreamsBearer(headers, ctx.durableStreamsBearer, {
      overwrite: false,
    })
    const nextInit: RequestInit & {
      dispatcher?: TenantContext[`durableStreamsDispatcher`]
    } = {
      ...(init ?? {}),
      headers,
    }
    if (ctx.durableStreamsDispatcher) {
      nextInit.dispatcher = ctx.durableStreamsDispatcher
    }
    return await fetch(input, nextInit as RequestInit)
  }
}

function resolveDurableStreamsWebhookSignature(
  ctx: TenantContext
): false | WebhookSignatureVerifierConfig {
  if (ctx.durableStreamsWebhookSignature === false) return false

  return {
    jwksUrl:
      ctx.durableStreamsWebhookSignature?.jwksUrl ??
      durableStreamsWebhookJwksUrl(ctx),
    toleranceSeconds: ctx.durableStreamsWebhookSignature?.toleranceSeconds,
    cacheTtlMs: ctx.durableStreamsWebhookSignature?.cacheTtlMs,
    fetchClient:
      ctx.durableStreamsWebhookSignature?.fetchClient ??
      durableStreamsJwksFetchClient(ctx),
  }
}

async function verifyDurableStreamsWebhook(
  request: IRequest,
  ctx: TenantContext,
  body: Uint8Array
): Promise<Response | null> {
  const config = resolveDurableStreamsWebhookSignature(ctx)
  if (config === false) return null

  const verification = await verifyWebhookSignature(
    body,
    request.headers.get(`webhook-signature`),
    config
  )
  if (verification.ok) return null

  return apiError(
    verification.status,
    verification.status === 401
      ? ErrCodeUnauthorized
      : `WEBHOOK_SIGNATURE_UNAVAILABLE`,
    verification.error
  )
}

function claimTokenFromRequest(request: IRequest): string | undefined {
  const electricClaimToken = request.headers.get(`electric-claim-token`)?.trim()
  if (electricClaimToken) return electricClaimToken
  return (
    request.headers
      .get(`authorization`)
      ?.replace(/^Bearer\s+/i, ``)
      .trim() || undefined
  )
}

function newWebhookPayload(body: WebhookForwardBody | undefined): {
  wakeId: string
  generation: number
  primaryStream: string
  tailOffset: string
  callbackUrl: string
  callbackToken: string
} | null {
  if (
    !body ||
    typeof body.subscription_id !== `string` ||
    typeof body.wake_id !== `string` ||
    typeof body.generation !== `number` ||
    typeof body.callback_url !== `string` ||
    typeof body.callback_token !== `string` ||
    !Array.isArray(body.streams)
  ) {
    return null
  }

  const streamInfos = body.streams as Array<
    | {
        path?: unknown
        tail_offset?: unknown
        has_pending?: unknown
      }
    | undefined
  >
  const firstStream =
    streamInfos.find((stream) => stream?.has_pending === true) ?? streamInfos[0]
  const selectedStream = firstStream as
    | {
        path?: unknown
        tail_offset?: unknown
      }
    | undefined
  if (
    typeof selectedStream?.path !== `string` ||
    typeof selectedStream.tail_offset !== `string`
  ) {
    return null
  }

  return {
    wakeId: body.wake_id,
    generation: body.generation,
    primaryStream: withLeadingSlash(selectedStream.path),
    tailOffset: selectedStream.tail_offset,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token,
  }
}

function toRuntimeStreamPath(
  path: string,
  service: string,
  routingAdapter: DurableStreamsRoutingAdapter
): string {
  return withLeadingSlash(routingAdapter.toRuntimeStreamPath(service, path))
}

async function registerWake(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const opts = routeBody<WakeRegistrationBody>(request)
  await ctx.entityManager.registerWake(opts)
  return status(204)
}

async function listEventSources(
  _request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const eventSources = ctx.eventSources
    ? await ctx.eventSources.listEventSources()
    : []
  return json({ eventSources: eventSources.filter(isAgentVisibleEventSource) })
}

function isAgentVisibleEventSource(source: EventSourceContract): boolean {
  return source.agentVisible === true && source.status === `active`
}

async function webhookForward(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const rootSpan = getRequestSpan(request)
  rootSpan?.updateName(`webhook-forward`)
  rootSpan?.setAttribute(
    `electric_agents.webhook.subscription_id`,
    subscriptionId
  )

  const body = await readRequestBody(request as Request)
  const signatureError = await verifyDurableStreamsWebhook(request, ctx, body)
  if (signatureError) return signatureError

  const targetWebhookUrl: string | null = await tracer.startActiveSpan(
    `db.lookupSubscription`,
    async (span) => {
      try {
        const rows = await ctx.pgDb
          .select()
          .from(subscriptionWebhooks)
          .where(
            and(
              eq(subscriptionWebhooks.tenantId, ctx.service),
              eq(subscriptionWebhooks.subscriptionId, subscriptionId)
            )
          )
          .limit(1)
        return rows[0]?.webhookUrl ?? null
      } finally {
        span.end()
      }
    }
  )

  if (!targetWebhookUrl) {
    return apiError(
      404,
      ErrCodeSubscriptionNotFound,
      `Unknown webhook subscription`
    )
  }
  const parsedBodyResult = validateOptionalJsonBody(
    webhookForwardBodySchema,
    body,
    request.headers.get(`content-type`)
  )
  if (!parsedBodyResult.ok) return parsedBodyResult.response

  let forwardBody = body
  let runningEntityUrl: string | null = null
  const parsedBody = parsedBodyResult.value as WebhookForwardBody | undefined
  const newWebhook = newWebhookPayload(parsedBody)
  const routingAdapter = resolveDurableStreamsRoutingAdapter(
    ctx.durableStreamsRouting,
    ctx.durableStreamsUrl
  )

  if (parsedBody) {
    const rawPrimaryStream =
      newWebhook?.primaryStream ??
      parsedBody.primary_stream ??
      parsedBody.primaryStream ??
      parsedBody.streamPath ??
      null
    const primaryStream =
      typeof rawPrimaryStream === `string`
        ? toRuntimeStreamPath(rawPrimaryStream, ctx.service, routingAdapter)
        : null
    const consumerId =
      newWebhook?.wakeId ??
      parsedBody.consumerId ??
      parsedBody.consumer_id ??
      null
    const callbackUrl = newWebhook?.callbackUrl ?? parsedBody.callback ?? null

    if (primaryStream) {
      rootSpan?.setAttribute(ATTR.STREAM_PATH, primaryStream)

      const entityPromise = tracer.startActiveSpan(
        `db.getEntityByStream`,
        async (span) => {
          try {
            return await ctx.entityManager.registry.getEntityByStream(
              primaryStream
            )
          } finally {
            span.end()
          }
        }
      )
      const enrichPromise = tracer.startActiveSpan(
        `electric_agents.enrichPayload`,
        async (span) => {
          try {
            return await ctx.entityManager.enrichPayload(parsedBody, {
              primary_stream: primaryStream,
            })
          } finally {
            span.end()
          }
        }
      )

      const upsertPromise =
        consumerId && callbackUrl
          ? tracer
              .startActiveSpan(`db.upsertConsumerCallback`, async (span) => {
                try {
                  await ctx.pgDb
                    .insert(consumerCallbacks)
                    .values({
                      tenantId: ctx.service,
                      consumerId,
                      callbackUrl,
                      primaryStream,
                    })
                    .onConflictDoUpdate({
                      target: [
                        consumerCallbacks.tenantId,
                        consumerCallbacks.consumerId,
                      ],
                      set: { callbackUrl, primaryStream },
                    })
                } finally {
                  span.end()
                }
              })
              .catch((err) => {
                serverLog.warn(
                  `[webhook-forward] consumerCallbacks upsert failed (non-fatal): ${
                    err instanceof Error ? err.message : String(err)
                  }`
                )
              })
          : undefined

      const [entity, enriched] = await Promise.all([
        entityPromise,
        enrichPromise,
      ])

      if (entity?.status === `stopped` || entity?.status === `paused`) {
        if (upsertPromise) await upsertPromise
        return json({ done: true })
      }

      if (upsertPromise) await upsertPromise

      if (entity && ctx.entityManager.isForkWorkLockedEntity(entity.url)) {
        return apiError(
          409,
          ErrCodeForkInProgress,
          `Entity subtree is being forked`
        )
      }

      if (entity) {
        rootSpan?.setAttribute(ATTR.ENTITY_URL, entity.url)
        await tracer.startActiveSpan(
          `db.updateStatus.running`,
          async (span) => {
            try {
              await ctx.entityManager.registry.updateStatus(
                entity.url,
                `running`
              )
            } finally {
              span.end()
            }
          }
        )
        runningEntityUrl = entity.url
      }

      if (consumerId && callbackUrl) {
        const callback = appendPathToUrl(
          ctx.publicUrl,
          `/_electric/callback-forward/${encodeURIComponent(consumerId)}`
        )
        enriched.callback = callback
        if (newWebhook) {
          enriched.consumerId = newWebhook.wakeId
          enriched.epoch = newWebhook.generation
          enriched.wakeId = newWebhook.wakeId
          enriched.streamPath = primaryStream
          enriched.streams = [
            { path: primaryStream, offset: newWebhook.tailOffset },
          ]
          enriched.claimToken = newWebhook.callbackToken
        }
      }
      forwardBody = new TextEncoder().encode(JSON.stringify(enriched))
    }
  }

  const headers = forwardHeadersFromRequest(request)
  headers.set(`content-type`, `application/json`)
  headers.delete(`content-length`)
  headers.set(
    `webhook-signature`,
    await resolveWebhookSigner(ctx).sign(forwardBody)
  )

  let upstream: Response
  try {
    upstream = await tracer.startActiveSpan(
      `fetch.agent-handler`,
      async (span) => {
        span.setAttribute(`http.url`, targetWebhookUrl)
        try {
          return await fetch(targetWebhookUrl, {
            method: request.method,
            headers,
            body: bodyFromBytes(forwardBody),
          })
        } finally {
          span.end()
        }
      }
    )
  } catch (err) {
    if (runningEntityUrl) {
      await ctx.entityManager.registry.updateStatus(runningEntityUrl, `idle`)
    }
    return apiError(
      502,
      `WEBHOOK_FORWARD_FAILED`,
      err instanceof Error ? err.message : String(err)
    )
  }

  const responseBytes = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()
  return responseFromUpstream(upstream, responseBytes)
}

async function callbackForward(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const consumerId = routeParam(request, `consumerId`)
  const rows = await ctx.pgDb
    .select()
    .from(consumerCallbacks)
    .where(
      and(
        eq(consumerCallbacks.tenantId, ctx.service),
        eq(consumerCallbacks.consumerId, consumerId)
      )
    )
    .limit(1)
  const target = rows[0]
    ? {
        callbackUrl: rows[0].callbackUrl,
        primaryStream: rows[0].primaryStream,
      }
    : undefined

  if (!target) {
    return apiError(
      404,
      ErrCodeCallbackNotFound,
      `Unknown callback-forward consumer`
    )
  }

  const body = await readRequestBody(request as Request)
  const parsedBodyResult = validateOptionalJsonBody(
    callbackForwardBodySchema,
    body,
    request.headers.get(`content-type`)
  )
  if (!parsedBodyResult.ok) return parsedBodyResult.response
  const requestBody = parsedBodyResult.value as CallbackForwardBody | undefined
  const isClaimRequest =
    requestBody?.wakeId !== undefined || requestBody?.wake_id !== undefined
  const isDoneRequest = requestBody?.done === true

  const headers = forwardHeadersFromRequest(request)
  headers.delete(`content-length`)

  if (isClaimRequest && !isDoneRequest) {
    let responseBody: Record<string, unknown> = { ok: true }
    if (target.primaryStream) {
      const writeToken = await mintClaimWriteToken(
        ctx,
        target.primaryStream,
        consumerId
      )
      if (writeToken) {
        responseBody = { ...responseBody, writeToken }
      }
    }
    return json(responseBody)
  }

  const upstreamBody = encodeCallbackForwardBody(
    ctx.service,
    consumerId,
    requestBody,
    resolveDurableStreamsRoutingAdapter(
      ctx.durableStreamsRouting,
      ctx.durableStreamsUrl
    )
  )

  let upstream: Response
  try {
    const subscriptionId = durableStreamsSubscriptionCallback(
      target.callbackUrl
    )
    if (subscriptionId) {
      const token = claimTokenFromRequest(request)
      if (!token) {
        return apiError(401, `UNAUTHORIZED`, `Missing claim token`)
      }
      const upstreamPayload = encodeCallbackForwardPayload(
        consumerId,
        requestBody,
        (stream) => stream.replace(/^\/+/, ``)
      )
      const result = await ctx.streamClient.ackSubscription(
        subscriptionId,
        token,
        upstreamPayload
      )
      upstream = json(result)
    } else {
      upstream = await fetch(target.callbackUrl, {
        method: request.method,
        headers,
        body: bodyFromBytes(upstreamBody),
      })
    }
  } catch (err) {
    return apiError(
      502,
      `CALLBACK_FORWARD_FAILED`,
      err instanceof Error ? err.message : String(err)
    )
  }

  let responseBytes: Uint8Array = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()

  if (isClaimRequest && upstream.ok && target.primaryStream) {
    const responseBody = decodeJsonObject(responseBytes)
    if (responseBody?.ok === true) {
      const writeToken = await mintClaimWriteToken(
        ctx,
        target.primaryStream,
        consumerId
      )
      if (writeToken) {
        responseBody.writeToken = writeToken
        responseBytes = new TextEncoder().encode(JSON.stringify(responseBody))
      }
    }
  }

  try {
    const epoch = requestBody?.generation ?? requestBody?.epoch
    if (
      upstream.ok &&
      !isDoneRequest &&
      epoch !== undefined &&
      target.primaryStream
    ) {
      await ctx.entityManager.registry.materializeHeartbeatClaim?.({
        consumerId,
        epoch,
      })
    }
    if (upstream.ok && isDoneRequest && target.primaryStream) {
      serverLog.info(
        `[callback-forward] done received for stream=${target.primaryStream} consumer=${consumerId}`
      )
      const stillOwnsClaim = ctx.runtime.claimWriteTokens.owns(
        ctx.service,
        target.primaryStream,
        consumerId
      )
      const entity = await ctx.entityManager.registry.getEntityByStream(
        target.primaryStream
      )

      // Release the consumer_claims row by its DB identity (consumerId,
      // epoch). The in-memory write token is a separate concern (write
      // authorization during the run); release of the durable row must
      // succeed even if the token was lost (server restart) or evicted
      // (a later wake re-minted for the same stream).
      let entityCleared = false
      if (epoch !== undefined) {
        const result =
          await ctx.entityManager.registry.materializeReleasedClaim?.({
            consumerId,
            epoch,
            ackedStreams: Array.isArray(requestBody?.acks)
              ? requestBody.acks.flatMap((ack) => {
                  const stream =
                    typeof ack.stream === `string`
                      ? ack.stream
                      : typeof ack.path === `string`
                        ? ack.path
                        : undefined
                  const offset =
                    typeof ack.offset === `string` ? ack.offset : undefined
                  return stream && offset ? [{ path: stream, offset }] : []
                })
              : undefined,
          })
        entityCleared = result?.entityCleared ?? false
      }

      // Transition entity back to idle when either signal says it's safe:
      // - entityCleared: our release just cleared the entity's active
      //   dispatch state, so no in-flight wake remains.
      // - stillOwnsClaim: this consumer is still the in-memory write-token
      //   owner, so no newer wake has displaced it. Covers two cases:
      //   (a) retry of a failed done (first attempt cleared the DB state
      //   but failed to update status), (b) server restart scenarios where
      //   the token is intact even though entityDispatchState may diverge.
      // If both are false, a newer wake owns the entity — leave status as-is.
      if (entity && (entityCleared || stillOwnsClaim)) {
        await ctx.entityManager.registry.updateStatus(
          entity.url,
          entity.status === `stopping` ? `stopped` : `idle`
        )
        await ctx.entityBridgeManager.onEntityChanged(entity.url)
        serverLog.info(
          `[callback-forward] status updated after done for ${entity.url}`
        )
      } else if (!entity) {
        serverLog.warn(
          `[callback-forward] done received but no entity found for stream=${target.primaryStream}`
        )
      }

      // Clear the in-memory write token only if this consumer still owns it.
      // If a newer wake has taken over, that newer wake owns the token now
      // and we must not clear it out from under it.
      if (stillOwnsClaim) {
        ctx.runtime.claimWriteTokens.clearStream(
          ctx.service,
          target.primaryStream
        )
      } else if (entity) {
        serverLog.info(
          `[callback-forward] done arrived after in-memory token evicted (stream=${target.primaryStream} consumer=${consumerId})`
        )
      }
    } else if (requestBody?.done === true) {
      serverLog.warn(
        `[callback-forward] done received but skipped: upstream.ok=${upstream.ok} primaryStream=${
          target.primaryStream ?? `null`
        } consumer=${consumerId}`
      )
    }
  } catch (err) {
    serverLog.error(
      `[callback-forward] error processing done for consumer=${consumerId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  return responseFromUpstream(upstream, responseBytes)
}

async function mintClaimWriteToken(
  ctx: TenantContext,
  streamPath: string,
  consumerId: string
): Promise<string | undefined> {
  const entity = await ctx.entityManager.registry.getEntityByStream(streamPath)
  if (!entity) return undefined

  return ctx.runtime.claimWriteTokens.mint(ctx.service, streamPath, consumerId)
}

function encodeCallbackForwardBody(
  service: string,
  consumerId: string,
  body: CallbackForwardBody | undefined,
  routingAdapter: DurableStreamsRoutingAdapter
): Uint8Array {
  const payload = encodeCallbackForwardPayload(consumerId, body, (stream) =>
    routingAdapter.toBackendStreamPath(service, stream)
  )
  return new TextEncoder().encode(JSON.stringify(payload))
}

function encodeCallbackForwardPayload(
  consumerId: string,
  body: CallbackForwardBody | undefined,
  mapStream: (stream: string) => string
): Record<string, unknown> {
  if (!body) return {}
  const generation = body.generation ?? body.epoch
  const wakeId = body.wake_id ?? body.wakeId ?? consumerId
  const acks = Array.isArray(body.acks)
    ? body.acks.map((ack) => {
        const input = ack as {
          path?: unknown
          stream?: unknown
          offset?: unknown
        }
        const stream =
          typeof input.stream === `string`
            ? input.stream
            : typeof input.path === `string`
              ? input.path
              : ``
        return {
          stream: mapStream(stream),
          offset: typeof input.offset === `string` ? input.offset : ``,
        }
      })
    : []

  return {
    wake_id: wakeId,
    ...(generation !== undefined ? { generation } : {}),
    acks,
    ...(body.done !== undefined ? { done: body.done } : {}),
  }
}
