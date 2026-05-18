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
import { resolveDurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'
import type { IRequest, RouterType } from 'itty-router'
import type { TenantContext } from './context.js'
import type { DurableStreamsRoutingAdapter } from './durable-streams-routing-adapter.js'

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
  subscriptionBase
)
durableStreamsRouter.get(
  `/__ds/subscriptions/:subscriptionId`,
  subscriptionBase
)
durableStreamsRouter.delete(
  `/__ds/subscriptions/:subscriptionId`,
  subscriptionBase
)
durableStreamsRouter.post(
  `/__ds/subscriptions/:subscriptionId/streams`,
  subscriptionStreams
)
durableStreamsRouter.delete(
  `/__ds/subscriptions/:subscriptionId/streams/:streamPath+`,
  subscriptionStream
)
for (const action of subscriptionControlActions) {
  durableStreamsRouter.post(
    `/__ds/subscriptions/:subscriptionId/${action}`,
    subscriptionAction(action)
  )
}
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
  return new Response(body ? bodyFromBytes(body) : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  })
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

type SubscriptionProxyAction =
  | `base`
  | `streams`
  | `stream`
  | `callback`
  | `claim`
  | `ack`
  | `release`

interface SubscriptionProxyRoute {
  subscriptionId: string
  action: SubscriptionProxyAction
  streamPath?: string
}

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

function rewriteSubscriptionResponseForClient(
  bytes: Uint8Array,
  response: Response,
  service: string,
  routingAdapter: DurableStreamsRoutingAdapter
): Uint8Array {
  if (!response.headers.get(`content-type`)?.includes(`application/json`)) {
    return bytes
  }
  const payload = decodeJson(bytes)
  if (!payload) return bytes

  if (typeof payload.pattern === `string`) {
    payload.pattern = routingAdapter.toRuntimeStreamPath(
      service,
      payload.pattern
    )
  }
  if (Array.isArray(payload.streams)) {
    payload.streams = payload.streams.map((stream) => {
      if (typeof stream === `string`) {
        return routingAdapter.toRuntimeStreamPath(service, stream)
      }
      if (
        stream &&
        typeof stream === `object` &&
        typeof (stream as Record<string, unknown>).path === `string`
      ) {
        return {
          ...(stream as Record<string, unknown>),
          path: routingAdapter.toRuntimeStreamPath(
            service,
            (stream as Record<string, string>).path
          ),
        }
      }
      return stream
    })
  }
  if (typeof payload.wake_stream === `string`) {
    payload.wake_stream = routingAdapter.toRuntimeStreamPath(
      service,
      payload.wake_stream
    )
  }
  if (typeof payload.stream === `string`) {
    payload.stream = routingAdapter.toRuntimeStreamPath(service, payload.stream)
  }
  if (Array.isArray(payload.acks)) {
    payload.acks = payload.acks.map((ack) => {
      if (!ack || typeof ack !== `object`) return ack
      const next = { ...(ack as Record<string, unknown>) }
      if (typeof next.stream === `string`) {
        next.stream = routingAdapter.toRuntimeStreamPath(service, next.stream)
      }
      if (typeof next.path === `string`) {
        next.path = routingAdapter.toRuntimeStreamPath(service, next.path)
      }
      return next
    })
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

function subscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  return subscriptionProxy(request, ctx, {
    subscriptionId: routeParam(request, `subscriptionId`),
    action: `base`,
  })
}

function subscriptionStreams(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  return subscriptionProxy(request, ctx, {
    subscriptionId: routeParam(request, `subscriptionId`),
    action: `streams`,
  })
}

function subscriptionStream(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  return subscriptionProxy(request, ctx, {
    subscriptionId: routeParam(request, `subscriptionId`),
    action: `stream`,
    streamPath: routeParam(request, `streamPath`),
  })
}

function subscriptionAction(action: SubscriptionProxyAction) {
  return (request: IRequest, ctx: TenantContext): Promise<Response> =>
    subscriptionProxy(request, ctx, {
      subscriptionId: routeParam(request, `subscriptionId`),
      action,
    })
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

async function subscriptionProxy(
  request: IRequest,
  ctx: TenantContext,
  route: SubscriptionProxyRoute
): Promise<Response> {
  const url = new URL(request.url)
  const { subscriptionId } = route

  const routingAdapter = resolveDurableStreamsRoutingAdapter(
    ctx.durableStreamsRouting,
    ctx.durableStreamsUrl
  )
  let requestBody: Uint8Array | undefined
  let targetWebhookUrl: string | null = null
  let requestUrl = request.url

  if ([`PUT`, `POST`].includes(request.method.toUpperCase())) {
    requestBody = await readRequestBody(request as Request)
    if (requestBody.length > 0) {
      const validation = validateBody(subscriptionProxyBodySchema, requestBody)
      if (!validation.ok) return validation.response
      const payload = validation.value as SubscriptionProxyBody
      if (payload.webhook?.url !== undefined) {
        targetWebhookUrl =
          rewriteLoopbackWebhookUrl(payload.webhook.url) ?? null
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
      requestBody = new TextEncoder().encode(JSON.stringify(payload))
    }
  }

  if (request.method.toUpperCase() === `DELETE` && route.action === `stream`) {
    requestUrl = rewriteSubscriptionStreamPathInUrl(
      url,
      ctx.service,
      routingAdapter,
      route.streamPath ?? ``
    )
  }

  const durableStreamsBearerMode =
    route.action === `ack` ||
    route.action === `release` ||
    route.action === `callback`
      ? `if-missing`
      : `overwrite`
  const upstream = await forwardToDurableStreams(
    ctx,
    request,
    requestBody,
    `control`,
    requestUrl,
    durableStreamsBearerMode
  )
  let responseBytes: Uint8Array = upstream.body
    ? new Uint8Array(await upstream.arrayBuffer())
    : new Uint8Array()
  responseBytes = rewriteSubscriptionResponseForClient(
    responseBytes,
    upstream,
    ctx.service,
    routingAdapter
  )
  const response = responseFromUpstream(upstream, responseBytes)

  if (!upstream.ok) return response

  if (request.method.toUpperCase() === `DELETE` && route.action === `base`) {
    await ctx.pgDb
      .delete(subscriptionWebhooks)
      .where(
        and(
          eq(subscriptionWebhooks.tenantId, ctx.service),
          eq(subscriptionWebhooks.subscriptionId, subscriptionId)
        )
      )
  } else if (targetWebhookUrl) {
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

  return response
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
