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
  ErrCodeWakeAlreadyClaimed,
  ErrCodeWakeCallbackNotFound,
  ErrCodeForkInProgress,
  ErrCodeSubscriptionNotFound,
  ErrCodeUnauthorized,
  ErrCodeWriteTokenUnavailable,
} from '../electric-agents-types.js'
import { ATTR, tracer } from '../tracing.js'
import { decodeJsonObject } from '../utils/server-utils.js'
import { serverLog } from '../utils/log.js'
import { DEFAULT_CLAIM_LEASE_MS } from '../claim-write-token-store.js'
import { applyDurableStreamsBearer } from '../stream-client.js'
import { getDefaultWebhookSigner } from '../webhook-signing.js'
import { resolveDurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import { electricProxyRouter } from './electric-proxy-router.js'
import { entitiesRouter } from './entities-router.js'
import { entityTypesRouter } from './entity-types-router.js'
import { pgSyncRouter } from './pg-sync-router.js'
import { getRequestSpan } from './hooks.js'
import { observationsRouter } from './observations-router.js'
import { runnersRouter } from './runners-router.js'
import { routeBody, validateOptionalJsonBody, withSchema } from './schema.js'
import { withLeadingSlash } from './tenant-stream-paths.js'
import type { IRequest, RouterType } from 'itty-router'
import type {
  WebhookSourceContract,
  WebhookSignatureVerifierConfig,
} from '@electric-ax/agents-runtime'
import type { ElectricAgentsEntity } from '../electric-agents-types.js'
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

const wakeUnregisterBodySchema = Type.Object({
  subscriberUrl: Type.String(),
  sourceUrl: Type.Optional(Type.String()),
  manifestKey: Type.Optional(Type.String()),
})

const subscriptionWebhookBodySchema = Type.Object(
  {
    subscription_id: Type.Optional(Type.String()),
    wake_id: Type.Optional(Type.String()),
    generation: Type.Optional(Type.Number()),
    streams: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Any()))),
    callback_url: Type.Optional(Type.String()),
    callback_token: Type.Optional(Type.String()),
    write_token: Type.Optional(Type.String()),
    primary_stream: Type.Optional(Type.String()),
    primaryStream: Type.Optional(Type.String()),
    streamPath: Type.Optional(Type.String()),
    consumerId: Type.Optional(Type.String()),
    consumer_id: Type.Optional(Type.String()),
    callback: Type.Optional(Type.String()),
  },
  { additionalProperties: true }
)

const wakeCallbackBodySchema = Type.Object(
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
type WakeUnregisterBody = Static<typeof wakeUnregisterBodySchema>
type SubscriptionWebhookBody = Static<typeof subscriptionWebhookBodySchema>
type WakeCallbackBody = Static<typeof wakeCallbackBodySchema>

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
internalRouter.get(`/webhook-sources`, listWebhookSources)
internalRouter.post(
  `/wake`,
  withSchema(wakeRegistrationBodySchema),
  registerWake
)
internalRouter.post(
  `/wake/unregister`,
  withSchema(wakeUnregisterBodySchema),
  unregisterWake
)
internalRouter.post(
  `/subscription-webhooks/:subscriptionId`,
  subscriptionWebhook
)
internalRouter.post(`/wake-callbacks/:consumerId`, wakeCallback)
internalRouter.all(`/runners`, runnersRouter.fetch)
internalRouter.all(`/runners/*`, runnersRouter.fetch)
internalRouter.all(`/entities/*`, entitiesRouter.fetch)
internalRouter.all(`/entity-types/*`, entityTypesRouter.fetch)
internalRouter.all(`/pg-sync/*`, pgSyncRouter.fetch)
internalRouter.all(`/observations/*`, observationsRouter.fetch)
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
    return appendPathToBackendUrl(ctx.durableStreamsUrl, `/__ds/jwks.json`)
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

function appendPathToBackendUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl)
  const pathUrl = new URL(path, `http://electric-agents.local`)
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  const suffix = pathUrl.pathname.startsWith(`/`)
    ? pathUrl.pathname
    : `/${pathUrl.pathname}`
  const target = new URL(base)

  target.pathname = `${basePath}${suffix}`
  target.search = ``
  target.hash = pathUrl.hash
  base.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  pathUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  return target.toString()
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

function newWebhookPayload(body: SubscriptionWebhookBody | undefined): {
  wakeId: string
  generation: number
  primaryStream: string
  tailOffset: string
  callbackUrl: string
  callbackToken: string
  writeToken?: string
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
    ...(body.write_token ? { writeToken: body.write_token } : {}),
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

async function unregisterWake(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const opts = routeBody<WakeUnregisterBody>(request)
  if (opts.sourceUrl !== undefined) {
    await ctx.entityManager.wakeRegistry.unregisterBySubscriberAndSource(
      opts.subscriberUrl,
      opts.sourceUrl,
      ctx.service
    )
    return status(204)
  }

  if (opts.manifestKey !== undefined) {
    await ctx.entityManager.wakeRegistry.unregisterByManifestKey(
      opts.subscriberUrl,
      opts.manifestKey,
      ctx.service
    )
    return status(204)
  }

  return apiError(
    400,
    `INVALID_WAKE_UNREGISTER`,
    `sourceUrl or manifestKey is required`
  )
}

async function listWebhookSources(
  _request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const webhookSources = ctx.webhookSources
    ? await ctx.webhookSources.listWebhookSources()
    : []
  return json({
    webhookSources: webhookSources.filter(isAgentVisibleWebhookSource),
  })
}

function isAgentVisibleWebhookSource(source: WebhookSourceContract): boolean {
  return source.agentVisible === true && source.status === `active`
}

async function subscriptionWebhook(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const rootSpan = getRequestSpan(request)
  rootSpan?.updateName(`subscription-webhook`)
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
    subscriptionWebhookBodySchema,
    body,
    request.headers.get(`content-type`)
  )
  if (!parsedBodyResult.ok) return parsedBodyResult.response

  let forwardBody = body
  let runningEntityUrl: string | null = null
  const parsedBody = parsedBodyResult.value as
    | SubscriptionWebhookBody
    | undefined
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
                  `[subscription-webhook] consumerCallbacks upsert failed (non-fatal): ${
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

      if (newWebhook?.writeToken) {
        // The backend minted this wake's write token before delivery (Write
        // Fencing extension); hold it for the runtime's claim callback to
        // adopt. Recorded only after the stopped/paused auto-ack and
        // fork-lock rejections above, so a wake that never reaches the
        // runtime — and therefore never claims — leaves no store entry
        // behind. It must be recorded before the forward below, because the
        // runtime's claim callback can arrive while the forward is still in
        // flight.
        ctx.runtime.claimWriteTokens.recordDelivered(
          ctx.service,
          newWebhook.wakeId,
          newWebhook.writeToken
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
          `/_electric/wake-callbacks/${encodeURIComponent(consumerId)}`
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
      await ctx.entityManager.registry.revertRunningStatus(runningEntityUrl)
    }
    return apiError(
      502,
      `SUBSCRIPTION_WEBHOOK_FAILED`,
      err instanceof Error ? err.message : String(err)
    )
  }

  const responseBytes = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()
  if (!upstream.ok && runningEntityUrl) {
    // The runtime refused the wake (draining, unknown type), so nothing will
    // claim or finish it; the backend retries later. Leaving `running` set
    // for that whole backoff misreports the entity, exactly as a failed
    // forward would.
    await ctx.entityManager.registry.revertRunningStatus(runningEntityUrl)
  }
  return responseFromUpstream(upstream, responseBytes)
}

async function wakeCallback(
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
      ErrCodeWakeCallbackNotFound,
      `Unknown wake-callback consumer`
    )
  }

  const body = await readRequestBody(request as Request)
  const parsedBodyResult = validateOptionalJsonBody(
    wakeCallbackBodySchema,
    body,
    request.headers.get(`content-type`)
  )
  if (!parsedBodyResult.ok) return parsedBodyResult.response
  const requestBody = parsedBodyResult.value as WakeCallbackBody | undefined
  const isDoneRequest = requestBody?.done === true
  // A done carries `wake_id` too (PROTOCOL §7.1) — only today's runtime
  // omits it. Routed as a claim it would be answered
  // WRITE_TOKEN_UNAVAILABLE (a backend mints no token for a done) and would
  // never reach the release below, leaving the claim and the entity's
  // dispatch state pointing at a wake that finished.
  const isClaimCallback =
    !isDoneRequest &&
    (requestBody?.wakeId !== undefined || requestBody?.wake_id !== undefined)
  const epoch = requestBody?.generation ?? requestBody?.epoch
  const subscriptionId = durableStreamsSubscriptionCallback(target.callbackUrl)

  const headers = forwardHeadersFromRequest(request)
  headers.delete(`content-length`)

  // Without stream fencing this store is the only write authority, so a claim
  // the backend refused — or never answered — is still safe to run locally:
  // the round trip is there to fetch the backend's token, not to gate the
  // wake, and answering the runtime with the backend's error would drop a
  // wake that used to run and make it wait out a lease. With fencing on there
  // is no such fallback: a token minted here is refused on the first append.
  const mintClaimLocally = async (reason: string): Promise<Response> => {
    serverLog.warn(
      `[wake-callback] claim not confirmed by the backend (${reason}); minting locally for consumer=${consumerId} (stream fencing off)`
    )
    const writeToken = target.primaryStream
      ? await mintClaimWriteToken(ctx, target.primaryStream, consumerId)
      : undefined
    return json(writeToken ? { ok: true, writeToken } : { ok: true })
  }

  // A claim is forwarded like a heartbeat rather than answered here: as a
  // non-done callback it renews the lease and, on a backend with the Write
  // Fencing extension, returns the wake's write token (PROTOCOL §7.1). The
  // server instance handling the claim is not necessarily the one that
  // received the delivery, so the token the delivery carried may live in
  // another process's memory; the backend is the only party that can hand it
  // to whichever instance the runtime reached.
  const upstreamBody = encodeWakeCallbackBody(
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
    if (subscriptionId) {
      const token = claimTokenFromRequest(request)
      if (!token) {
        return apiError(401, `UNAUTHORIZED`, `Missing claim token`)
      }
      const upstreamPayload = encodeWakeCallbackPayload(
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
    const message = err instanceof Error ? err.message : String(err)
    if (isClaimCallback && !ctx.entityManager.fencedSessionStreams) {
      return await mintClaimLocally(message)
    }
    return apiError(502, `WAKE_CALLBACK_FAILED`, message)
  }

  let responseBytes: Uint8Array = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()

  if (
    isClaimCallback &&
    !upstream.ok &&
    !ctx.entityManager.fencedSessionStreams
  ) {
    return await mintClaimLocally(`answered ${upstream.status}`)
  }

  if (isClaimCallback && upstream.ok && target.primaryStream) {
    const responseBody = decodeJsonObject(responseBytes)
    if (responseBody?.ok === true) {
      const entity = await ctx.entityManager.registry.getEntityByStream(
        target.primaryStream
      )
      const backendToken = backendWriteToken(responseBody)
      if (
        backendToken === undefined &&
        ctx.entityManager.fencedSessionStreams
      ) {
        // The backend is the write authority for fenced streams
        // (stream-append.ts), so a token minted here would be refused on the
        // runtime's first append, and `ok` without one lets the runtime
        // claim, fail every write and then ack the message away. Refuse the
        // claim instead: the runtime drops the wake unclaimed and the backend
        // re-wakes it when the lease lapses.
        return apiError(
          502,
          ErrCodeWriteTokenUnavailable,
          `Backend issued no write token for the claim`
        )
      }
      if (entity && epoch !== undefined && !subscriptionId) {
        // Pull-wake claims were materialised when the runner claimed them
        // (runners-router); webhook wakes only now, once the backend has
        // confirmed the claim is live, so no row is left behind for a wake
        // that was delivered but never claimed.
        const claimed = await materializeCallbackClaim(
          ctx,
          entity,
          target.primaryStream,
          consumerId,
          epoch
        )
        if (!claimed) {
          return apiError(
            409,
            ErrCodeWakeAlreadyClaimed,
            `Wake is already claimed`
          )
        }
      }
      const writeToken = await mintClaimWriteToken(
        ctx,
        target.primaryStream,
        consumerId,
        backendToken,
        entity
      )
      if (writeToken) {
        responseBody.writeToken = writeToken
        responseBytes = new TextEncoder().encode(JSON.stringify(responseBody))
      }
    }
  } else if (!isDoneRequest && upstream.ok && target.primaryStream) {
    // Heartbeat: a backend implementing the Write Fencing extension re-mints
    // the claim's write token on every ack. Adopt the refresh so the active
    // token tracks the backend's, and surface it to the runtime as
    // `writeToken` alongside the passed-through ack body.
    const responseBody = decodeJsonObject(responseBytes)
    const refreshedToken = backendWriteToken(responseBody)
    if (responseBody?.ok === true && refreshedToken !== undefined) {
      const writeToken = await mintClaimWriteToken(
        ctx,
        target.primaryStream,
        consumerId,
        refreshedToken
      )
      if (writeToken) {
        responseBody.writeToken = writeToken
        responseBytes = new TextEncoder().encode(JSON.stringify(responseBody))
      }
    } else if (responseBody?.ok === true) {
      ctx.runtime.claimWriteTokens.renew(ctx.service, consumerId)
    }
  }

  try {
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
        `[wake-callback] done received for stream=${target.primaryStream} consumer=${consumerId}`
      )
      // Release the consumer_claims row by its DB identity (consumerId,
      // epoch). The in-memory write token is a separate concern (write
      // authorization during the run); release of the durable row must
      // succeed even if the token was lost (server restart) or evicted
      // (a later wake re-minted for the same stream).
      let entityCleared = false
      let releasedClaimStream = target.primaryStream
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
        releasedClaimStream = result?.claim?.stream_path ?? releasedClaimStream
      }

      const stillOwnsClaim = ctx.runtime.claimWriteTokens.owns(
        ctx.service,
        releasedClaimStream,
        consumerId
      )
      const entity =
        await ctx.entityManager.registry.getEntityByStream(releasedClaimStream)

      // Transition the entity out of its run when either signal says it's
      // safe:
      // - entityCleared: our release just cleared the entity's active
      //   dispatch state, so no in-flight wake remains. This is the durable
      //   signal, and the one that holds on a server instance other than
      //   the one that minted the claim's write token.
      // - stillOwnsClaim: this consumer is still the in-memory write-token
      //   owner, so no newer wake has displaced it. Covers a retry of a
      //   failed done (first attempt cleared the DB state but failed to
      //   update status) on the minting instance.
      // If both are false, a newer wake owns the entity — leave status as-is.
      //
      // The settle is a statement of its own, not part of the release: the
      // next wake can be delivered in between and set `running` again, and
      // this write would then report `idle` under it. It is self-correcting
      // (that wake's own done settles the status, and `updateStatusAfterDone`
      // never touches a terminal status), which is why the release keeps the
      // narrower job of clearing the dispatch state.
      if (entity && (entityCleared || stillOwnsClaim)) {
        const status = await ctx.entityManager.registry.updateStatusAfterDone(
          entity.url
        )
        if (status !== null) {
          await ctx.entityBridgeManager.onEntityChanged(entity.url)
        }
        serverLog.info(
          `[wake-callback] status updated after done for ${entity.url}: ${status ?? `unchanged (${entity.status})`}`
        )
      } else if (!entity) {
        serverLog.warn(
          `[wake-callback] done received but no entity found for stream=${releasedClaimStream}`
        )
      }

      // Everything this consumer holds is finished: its claim entries (if
      // this instance minted or refreshed them) and its delivered token (if
      // this instance received the delivery but another one handled the
      // claim). Consumer-scoped, so a newer wake's entry for the same stream
      // is untouched.
      ctx.runtime.claimWriteTokens.clearConsumer(ctx.service, consumerId)
      if (!stillOwnsClaim && entity) {
        serverLog.info(
          `[wake-callback] done for a claim this instance did not mint (stream=${releasedClaimStream} consumer=${consumerId})`
        )
      }
    } else if (requestBody?.done === true) {
      serverLog.warn(
        `[wake-callback] done received but skipped: upstream.ok=${upstream.ok} primaryStream=${
          target.primaryStream ?? `null`
        } consumer=${consumerId}`
      )
    }
  } catch (err) {
    serverLog.error(
      `[wake-callback] error processing done for consumer=${consumerId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  return responseFromUpstream(upstream, responseBytes)
}

function backendWriteToken(
  responseBody: Record<string, unknown> | null
): string | undefined {
  const token = responseBody?.write_token
  return typeof token === `string` && token !== `` ? token : undefined
}

async function materializeCallbackClaim(
  ctx: TenantContext,
  entity: ElectricAgentsEntity,
  streamPath: string,
  consumerId: string,
  epoch: number
): Promise<boolean> {
  return await ctx.entityManager.registry.materializeActiveClaim({
    consumerId,
    epoch,
    wakeId: consumerId,
    entityUrl: entity.url,
    streamPath,
    // A webhook notification carries no `lease_ttl_ms` (PROTOCOL §7.1), so
    // the row records the subscription default the backend applied.
    leaseExpiresAt: new Date(Date.now() + DEFAULT_CLAIM_LEASE_MS),
    // The backend fences a callback for a lapsed or re-armed wake itself,
    // before this runs; the only way to meet an active row here is a second
    // delivery of a wake another runtime is still processing.
    unlessActive: true,
  })
}

async function mintClaimWriteToken(
  ctx: TenantContext,
  streamPath: string,
  consumerId: string,
  backendToken?: string,
  // The claim path has already looked the entity up for the durable row;
  // pass it in rather than reading it again on the wake's hot path.
  knownEntity?: ElectricAgentsEntity | null
): Promise<string | undefined> {
  const entity =
    knownEntity !== undefined
      ? knownEntity
      : await ctx.entityManager.registry.getEntityByStream(streamPath)
  if (!entity) return undefined

  // When the Durable Streams backend issued a write token for this claim
  // (Write Fencing extension), adopt it as the claim's write token so the
  // store stays the single validation authority while the backend is the
  // mint. When the backend supplied none, the store mints its own token —
  // from the delivery, if this instance received it — and behaviour is
  // byte-for-byte what it is today. (With `fencedSessionStreams` the claim
  // path has already refused a claim the backend issued no token for.)
  //
  // Version-skew matrix — adoption is data-driven (it follows `write_token`
  // fields wherever the backend sends them), while stream fencing is a
  // separate opt-in (`fencedSessionStreams`):
  // - Base backend (no Write Fencing), any server/runtime: no `write_token`
  //   ever appears, so the store mints and nothing changes — including for a
  //   claim the backend refused, which falls back to a local mint.
  //   `fencedSessionStreams` is not available against a base backend at all:
  //   stream creation fails on the missing fencing support
  //   (`assertWriteFenced`), and a claim it issues no token for is refused
  //   rather than minted for.
  // - Token-minting backend, older server (no adoption): the optional
  //   fields are ignored and the old server mints its own tokens; it never
  //   creates streams fenced, so the backend enforces nothing.
  // - Token-minting backend, this server, older runtime (one that ignores
  //   the heartbeat response's `writeToken`): adoption still happens here,
  //   so a backend that rotates the token on ack refresh ages the runtime's
  //   original token out of the store's one-refresh grace, and the
  //   runtime's appends start failing 401 mid-activation. Upgrade runtimes
  //   before pointing this server at a token-minting backend (and before
  //   enabling `fencedSessionStreams`).
  const token =
    backendToken ??
    ctx.runtime.claimWriteTokens.takeDelivered(ctx.service, consumerId)
  return ctx.runtime.claimWriteTokens.mint(
    ctx.service,
    streamPath,
    consumerId,
    token
  )
}

function encodeWakeCallbackBody(
  service: string,
  consumerId: string,
  body: WakeCallbackBody | undefined,
  routingAdapter: DurableStreamsRoutingAdapter
): Uint8Array {
  const payload = encodeWakeCallbackPayload(consumerId, body, (stream) =>
    routingAdapter.toBackendStreamPath(service, stream)
  )
  return new TextEncoder().encode(JSON.stringify(payload))
}

function encodeWakeCallbackPayload(
  consumerId: string,
  body: WakeCallbackBody | undefined,
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
