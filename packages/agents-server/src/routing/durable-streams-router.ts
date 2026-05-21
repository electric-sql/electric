/**
 * Root catch-all for Durable Streams traffic.
 */

import { appendPathToUrl } from '@electric-ax/agents-runtime'
import { Type, type Static } from '@sinclair/typebox'
import { and, eq } from 'drizzle-orm'
import { Router } from 'itty-router'
import { readRequestBody, responseHeaders } from '../electric-agents-http.js'
import { subscriptionWebhooks } from '../db/schema.js'
import {
  createStreamAppendRouteRequest,
  electricAgentsStreamAppendRouter,
} from './stream-append.js'
import { validateBody } from './schema.js'
import { rewriteLoopbackWebhookUrl } from '../utils/webhook-url.js'
import { forwardFetchRequest } from '../utils/server-utils.js'
import {
  getDefaultWebhookSigner,
  webhookSigningMetadata,
} from '../webhook-signing.js'
import { resolveDurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { IRequest, RouterType } from 'itty-router'
import type { TenantContext } from './context.js'
import type { DurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { WebhookSigner } from '../webhook-signing.js'

const subscriptionProxyBodySchema = Type.Object(
  {
    webhook: Type.Optional(
      Type.Object(
        {
          url: Type.String(),
        },
        { additionalProperties: true }
      )
    ),
  },
  { additionalProperties: true }
)

type SubscriptionProxyBody = Static<typeof subscriptionProxyBodySchema>

const subscriptionControlActions = [
  `callback`,
  `claim`,
  `ack`,
  `release`,
] as const

export type DurableStreamsRoutes = RouterType<
  IRequest,
  [TenantContext],
  Response | undefined
>

export const durableStreamsRouter: DurableStreamsRoutes = Router<
  IRequest,
  [TenantContext],
  Response | undefined
>()

durableStreamsRouter.put(
  `/__ds/subscriptions/:subscriptionId`,
  putSubscriptionBase
)
durableStreamsRouter.get(
  `/__ds/subscriptions/:subscriptionId`,
  getSubscriptionBase
)
durableStreamsRouter.delete(
  `/__ds/subscriptions/:subscriptionId`,
  deleteSubscriptionBase
)
durableStreamsRouter.post(
  `/__ds/subscriptions/:subscriptionId/streams`,
  postSubscriptionStreams
)
durableStreamsRouter.delete(
  `/__ds/subscriptions/:subscriptionId/streams/:streamPath+`,
  deleteSubscriptionStream
)
for (const action of subscriptionControlActions) {
  durableStreamsRouter.post(
    `/__ds/subscriptions/:subscriptionId/${action}`,
    subscriptionAction(action)
  )
}
durableStreamsRouter.get(`/__ds/jwks.json`, webhookJwks)
durableStreamsRouter.all(`/__ds`, controlPassThrough)
durableStreamsRouter.all(`/__ds/*`, controlPassThrough)
durableStreamsRouter.post(`*`, streamAppend)
durableStreamsRouter.all(`*`, proxyPassThrough)

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

async function forwardToDurableStreams(
  ctx: TenantContext,
  request: IRequest,
  body?: Uint8Array,
  route: `stream` | `control` = `stream`,
  urlOverride?: string,
  durableStreamsBearerMode: `overwrite` | `if-missing` = `overwrite`
): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.delete(`host`)

  let requestBody = body
  if (
    requestBody === undefined &&
    ![`GET`, `HEAD`].includes(request.method.toUpperCase())
  ) {
    requestBody = await readRequestBody(request as Request)
  }

  return await forwardFetchRequest({
    request: {
      method: request.method.toUpperCase(),
      url: urlOverride ?? request.url,
      headers,
    },
    body: requestBody,
    durableStreamsUrl: ctx.durableStreamsUrl,
    durableStreamsBearer: ctx.durableStreamsBearer,
    durableStreamsBearerMode,
    durableStreamsRouting: ctx.durableStreamsRouting,
    serviceId: ctx.service,
    dispatcher: ctx.durableStreamsDispatcher,
    route,
  })
}

type SubscriptionControlAction = (typeof subscriptionControlActions)[number]

function rewriteSubscriptionBodyForBackend(
  payload: Record<string, unknown>,
  service: string,
  routingAdapter: DurableStreamsRoutingAdapter
): void {
  if (typeof payload.pattern === `string`) {
    payload.pattern = routingAdapter.toBackendStreamPath(
      service,
      payload.pattern
    )
  }
  if (Array.isArray(payload.streams)) {
    payload.streams = payload.streams.map((stream) =>
      typeof stream === `string`
        ? routingAdapter.toBackendStreamPath(service, stream)
        : stream
    )
  }
  if (typeof payload.wake_stream === `string`) {
    payload.wake_stream = routingAdapter.toBackendStreamPath(
      service,
      payload.wake_stream
    )
  }
  if (Array.isArray(payload.acks)) {
    payload.acks = payload.acks.map((ack) => {
      if (!ack || typeof ack !== `object`) return ack
      const next = { ...(ack as Record<string, unknown>) }
      if (typeof next.stream === `string`) {
        next.stream = routingAdapter.toBackendStreamPath(service, next.stream)
      }
      if (typeof next.path === `string`) {
        next.path = routingAdapter.toBackendStreamPath(service, next.path)
      }
      return next
    })
  }
}

async function rewriteSubscriptionResponseForClient(
  bytes: Uint8Array,
  response: Response,
  ctx: TenantContext,
  routingAdapter: DurableStreamsRoutingAdapter
): Promise<Uint8Array> {
  if (!response.headers.get(`content-type`)?.includes(`application/json`)) {
    return bytes
  }
  const payload = decodeJson(bytes)
  if (!payload) return bytes

  if (typeof payload.pattern === `string`) {
    payload.pattern = routingAdapter.toRuntimeStreamPath(
      ctx.service,
      payload.pattern
    )
  }
  if (Array.isArray(payload.streams)) {
    payload.streams = payload.streams.map((stream) => {
      if (typeof stream === `string`) {
        return routingAdapter.toRuntimeStreamPath(ctx.service, stream)
      }
      if (
        stream &&
        typeof stream === `object` &&
        typeof (stream as Record<string, unknown>).path === `string`
      ) {
        return {
          ...(stream as Record<string, unknown>),
          path: routingAdapter.toRuntimeStreamPath(
            ctx.service,
            (stream as Record<string, string>).path
          ),
        }
      }
      return stream
    })
  }
  if (typeof payload.wake_stream === `string`) {
    payload.wake_stream = routingAdapter.toRuntimeStreamPath(
      ctx.service,
      payload.wake_stream
    )
  }
  if (typeof payload.stream === `string`) {
    payload.stream = routingAdapter.toRuntimeStreamPath(
      ctx.service,
      payload.stream
    )
  }
  if (Array.isArray(payload.acks)) {
    payload.acks = payload.acks.map((ack) => {
      if (!ack || typeof ack !== `object`) return ack
      const next = { ...(ack as Record<string, unknown>) }
      if (typeof next.stream === `string`) {
        next.stream = routingAdapter.toRuntimeStreamPath(
          ctx.service,
          next.stream
        )
      }
      if (typeof next.path === `string`) {
        next.path = routingAdapter.toRuntimeStreamPath(ctx.service, next.path)
      }
      return next
    })
  }
  if (
    payload.webhook &&
    typeof payload.webhook === `object` &&
    !Array.isArray(payload.webhook)
  ) {
    const webhook = payload.webhook as Record<string, unknown>
    webhook.signing = await webhookSigningMetadata(
      resolveWebhookSigner(ctx),
      ctx.publicUrl
    )
  }

  return new TextEncoder().encode(JSON.stringify(payload))
}

function decodeJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return parsed && typeof parsed === `object` && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function routeParam(request: IRequest, name: string): string {
  const value = request.params[name]
  const raw = Array.isArray(value) ? value[0] : value
  return decodeURIComponent(raw ?? ``)
}

function subscriptionRoutingAdapter(
  ctx: TenantContext
): DurableStreamsRoutingAdapter {
  return resolveDurableStreamsRoutingAdapter(
    ctx.durableStreamsRouting,
    ctx.durableStreamsUrl
  )
}

function resolveWebhookSigner(ctx: TenantContext): WebhookSigner {
  return ctx.webhookSigner ?? getDefaultWebhookSigner()
}

async function rewriteSubscriptionRequestBody(
  request: IRequest,
  ctx: TenantContext,
  subscriptionId: string,
  routingAdapter: DurableStreamsRoutingAdapter
): Promise<
  | {
      ok: true
      body: Uint8Array
      targetWebhookUrl: string | null
    }
  | { ok: false; response: Response }
> {
  const body = await readRequestBody(request as Request)
  if (body.length === 0) {
    return { ok: true, body, targetWebhookUrl: null }
  }

  const validation = validateBody(subscriptionProxyBodySchema, body)
  if (!validation.ok) return { ok: false, response: validation.response }

  const payload = validation.value as SubscriptionProxyBody
  let targetWebhookUrl: string | null = null
  if (payload.webhook?.url !== undefined) {
    targetWebhookUrl = rewriteLoopbackWebhookUrl(payload.webhook.url) ?? null
    payload.webhook.url = appendPathToUrl(
      ctx.publicUrl,
      `/_electric/webhook-forward/${encodeURIComponent(subscriptionId)}`
    )
  }

  rewriteSubscriptionBodyForBackend(
    payload as Record<string, unknown>,
    ctx.service,
    routingAdapter
  )

  return {
    ok: true,
    body: new TextEncoder().encode(JSON.stringify(payload)),
    targetWebhookUrl,
  }
}

async function forwardSubscriptionRequest(
  request: IRequest,
  ctx: TenantContext,
  routingAdapter: DurableStreamsRoutingAdapter,
  opts: {
    body?: Uint8Array
    requestUrl?: string
    bearerMode?: `overwrite` | `if-missing`
  } = {}
): Promise<{ upstream: Response; response: Response }> {
  const upstream = await forwardToDurableStreams(
    ctx,
    request,
    opts.body,
    `control`,
    opts.requestUrl,
    opts.bearerMode ?? `overwrite`
  )
  let responseBytes: Uint8Array = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()
  responseBytes = await rewriteSubscriptionResponseForClient(
    responseBytes,
    upstream,
    ctx,
    routingAdapter
  )
  return {
    upstream,
    response: responseFromUpstream(upstream, responseBytes),
  }
}

async function upsertSubscriptionWebhook(
  ctx: TenantContext,
  subscriptionId: string,
  targetWebhookUrl: string
): Promise<void> {
  await ctx.pgDb
    .insert(subscriptionWebhooks)
    .values({
      tenantId: ctx.service,
      subscriptionId,
      webhookUrl: targetWebhookUrl,
    })
    .onConflictDoUpdate({
      target: [
        subscriptionWebhooks.tenantId,
        subscriptionWebhooks.subscriptionId,
      ],
      set: { webhookUrl: targetWebhookUrl },
    })
}

async function deleteSubscriptionWebhook(
  ctx: TenantContext,
  subscriptionId: string
): Promise<void> {
  await ctx.pgDb
    .delete(subscriptionWebhooks)
    .where(
      and(
        eq(subscriptionWebhooks.tenantId, ctx.service),
        eq(subscriptionWebhooks.subscriptionId, subscriptionId)
      )
    )
}

function rewriteSubscriptionStreamPathInUrl(
  requestUrl: URL,
  service: string,
  routingAdapter: DurableStreamsRoutingAdapter,
  streamPath: string
): string {
  const prefix = requestUrl.pathname.slice(
    0,
    requestUrl.pathname.indexOf(`/streams/`) + `/streams/`.length
  )
  requestUrl.pathname = `${prefix}${encodeURIComponent(
    routingAdapter.toBackendStreamPath(service, streamPath)
  )}`
  return requestUrl.toString()
}

async function putSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const routingAdapter = subscriptionRoutingAdapter(ctx)
  const rewrite = await rewriteSubscriptionRequestBody(
    request,
    ctx,
    subscriptionId,
    routingAdapter
  )
  if (!rewrite.ok) return rewrite.response

  const { upstream, response } = await forwardSubscriptionRequest(
    request,
    ctx,
    routingAdapter,
    { body: rewrite.body }
  )
  if (upstream.ok && rewrite.targetWebhookUrl) {
    await upsertSubscriptionWebhook(
      ctx,
      subscriptionId,
      rewrite.targetWebhookUrl
    )
  }
  return response
}

async function getSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const routingAdapter = subscriptionRoutingAdapter(ctx)
  return (await forwardSubscriptionRequest(request, ctx, routingAdapter))
    .response
}

async function deleteSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const routingAdapter = subscriptionRoutingAdapter(ctx)
  const { upstream, response } = await forwardSubscriptionRequest(
    request,
    ctx,
    routingAdapter
  )
  if (upstream.ok) {
    await deleteSubscriptionWebhook(ctx, subscriptionId)
  }
  return response
}

async function postSubscriptionStreams(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const routingAdapter = subscriptionRoutingAdapter(ctx)
  const rewrite = await rewriteSubscriptionRequestBody(
    request,
    ctx,
    subscriptionId,
    routingAdapter
  )
  if (!rewrite.ok) return rewrite.response

  return (
    await forwardSubscriptionRequest(request, ctx, routingAdapter, {
      body: rewrite.body,
    })
  ).response
}

async function deleteSubscriptionStream(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const routingAdapter = subscriptionRoutingAdapter(ctx)
  const requestUrl = rewriteSubscriptionStreamPathInUrl(
    new URL(request.url),
    ctx.service,
    routingAdapter,
    routeParam(request, `streamPath`)
  )
  return (
    await forwardSubscriptionRequest(request, ctx, routingAdapter, {
      requestUrl,
    })
  ).response
}

function subscriptionAction(action: SubscriptionControlAction) {
  return async (request: IRequest, ctx: TenantContext): Promise<Response> => {
    const subscriptionId = routeParam(request, `subscriptionId`)
    const routingAdapter = subscriptionRoutingAdapter(ctx)
    const rewrite = await rewriteSubscriptionRequestBody(
      request,
      ctx,
      subscriptionId,
      routingAdapter
    )
    if (!rewrite.ok) return rewrite.response

    const bearerMode =
      action === `ack` || action === `release` || action === `callback`
        ? `if-missing`
        : `overwrite`
    return (
      await forwardSubscriptionRequest(request, ctx, routingAdapter, {
        body: rewrite.body,
        bearerMode,
      })
    ).response
  }
}

async function controlPassThrough(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const upstream = await forwardToDurableStreams(
    ctx,
    request,
    undefined,
    `control`
  )
  return responseFromUpstream(upstream)
}

async function webhookJwks(
  _request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  return new Response(JSON.stringify(await resolveWebhookSigner(ctx).jwks()), {
    status: 200,
    headers: {
      'content-type': `application/jwk-set+json`,
      'cache-control': `public, max-age=300`,
    },
  })
}

async function streamAppend(
  request: IRequest,
  ctx: TenantContext
): Promise<Response | undefined> {
  return await electricAgentsStreamAppendRouter.fetch(
    createStreamAppendRouteRequest(request as Request),
    ctx.runtime,
    (req, body) =>
      forwardFetchRequest({
        request: {
          method: req.method,
          url: req.url,
          headers: req.headers,
        },
        body,
        durableStreamsUrl: ctx.durableStreamsUrl,
        durableStreamsBearer: ctx.durableStreamsBearer,
        durableStreamsBearerMode: `overwrite`,
        durableStreamsRouting: ctx.durableStreamsRouting,
        serviceId: ctx.service,
        dispatcher: ctx.durableStreamsDispatcher,
      })
  )
}

async function proxyPassThrough(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const upstream = await forwardToDurableStreams(ctx, request)
  const streamPath = new URL(request.url).pathname
  const method = request.method.toUpperCase()
  const endTrackedRead =
    method === `GET`
      ? await ctx.entityBridgeManager.beginClientRead(streamPath)
      : null
  try {
    if (method === `HEAD`) {
      await ctx.entityBridgeManager.touchByStreamPath(streamPath)
    }
    return responseFromUpstream(upstream)
  } finally {
    await endTrackedRead?.()
  }
}
