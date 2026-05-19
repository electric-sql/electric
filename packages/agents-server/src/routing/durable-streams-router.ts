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
import type { IRequest, RouterType } from 'itty-router'
import type { TenantContext } from './context.js'

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
    serviceId: ctx.service,
    durableStreamsBearer: ctx.durableStreamsBearer,
    durableStreamsBearerMode,
    durableStreamsRouting: ctx.durableStreamsRouting,
    dispatcher: ctx.durableStreamsDispatcher,
    route,
  })
}

type SubscriptionControlAction = (typeof subscriptionControlActions)[number]

function rewriteSubscriptionBodyForBackend(
  payload: Record<string, unknown>
): void {
  if (typeof payload.pattern === `string`) {
    payload.pattern = normalizeSubscriptionPath(payload.pattern)
  }
  if (Array.isArray(payload.streams)) {
    payload.streams = payload.streams.map((stream) =>
      typeof stream === `string` ? normalizeSubscriptionPath(stream) : stream
    )
  }
  if (typeof payload.wake_stream === `string`) {
    payload.wake_stream = normalizeSubscriptionPath(payload.wake_stream)
  }
  if (Array.isArray(payload.acks)) {
    payload.acks = payload.acks.map((ack) => {
      if (!ack || typeof ack !== `object`) return ack
      const next = { ...(ack as Record<string, unknown>) }
      if (typeof next.stream === `string`) {
        next.stream = normalizeSubscriptionPath(next.stream)
      }
      if (typeof next.path === `string`) {
        next.path = normalizeSubscriptionPath(next.path)
      }
      return next
    })
  }
}

function rewriteSubscriptionResponseForClient(
  bytes: Uint8Array,
  response: Response
): Uint8Array {
  if (!response.headers.get(`content-type`)?.includes(`application/json`)) {
    return bytes
  }
  const payload = decodeJson(bytes)
  if (!payload) return bytes

  if (typeof payload.pattern === `string`) {
    payload.pattern = normalizeSubscriptionPath(payload.pattern)
  }
  if (Array.isArray(payload.streams)) {
    payload.streams = payload.streams.map((stream) => {
      if (typeof stream === `string`) {
        return normalizeSubscriptionPath(stream)
      }
      if (
        stream &&
        typeof stream === `object` &&
        typeof (stream as Record<string, unknown>).path === `string`
      ) {
        return {
          ...(stream as Record<string, unknown>),
          path: normalizeSubscriptionPath(
            (stream as Record<string, string>).path
          ),
        }
      }
      return stream
    })
  }
  if (typeof payload.wake_stream === `string`) {
    payload.wake_stream = normalizeSubscriptionPath(payload.wake_stream)
  }
  if (typeof payload.stream === `string`) {
    payload.stream = normalizeSubscriptionPath(payload.stream)
  }
  if (Array.isArray(payload.acks)) {
    payload.acks = payload.acks.map((ack) => {
      if (!ack || typeof ack !== `object`) return ack
      const next = { ...(ack as Record<string, unknown>) }
      if (typeof next.stream === `string`) {
        next.stream = normalizeSubscriptionPath(next.stream)
      }
      if (typeof next.path === `string`) {
        next.path = normalizeSubscriptionPath(next.path)
      }
      return next
    })
  }

  return new TextEncoder().encode(JSON.stringify(payload))
}

function normalizeSubscriptionPath(path: string): string {
  return path.replace(/^\/+/, ``)
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

async function rewriteSubscriptionRequestBody(
  request: IRequest,
  ctx: TenantContext,
  subscriptionId: string
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

  rewriteSubscriptionBodyForBackend(payload as Record<string, unknown>)

  return {
    ok: true,
    body: new TextEncoder().encode(JSON.stringify(payload)),
    targetWebhookUrl,
  }
}

async function forwardSubscriptionRequest(
  request: IRequest,
  ctx: TenantContext,
  opts: {
    body?: Uint8Array
    requestUrl?: string
    bearerMode?: `overwrite` | `if-missing`
  } = {}
): Promise<{
  upstream: Response
  response: Response
  responseBytes: Uint8Array
}> {
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
  responseBytes = rewriteSubscriptionResponseForClient(responseBytes, upstream)
  return {
    upstream,
    response: responseFromUpstream(upstream, responseBytes),
    responseBytes,
  }
}

function webhookSecretFromSubscriptionResponse(
  body: Uint8Array
): string | undefined {
  if (body.length === 0) return undefined
  try {
    const json = JSON.parse(new TextDecoder().decode(body)) as {
      webhook_secret?: unknown
    }
    return typeof json.webhook_secret === `string`
      ? json.webhook_secret
      : undefined
  } catch {
    return undefined
  }
}

async function upsertSubscriptionWebhook(
  ctx: TenantContext,
  subscriptionId: string,
  targetWebhookUrl: string,
  webhookSecret: string | undefined
): Promise<void> {
  const values = {
    tenantId: ctx.service,
    subscriptionId,
    webhookUrl: targetWebhookUrl,
    ...(webhookSecret ? { webhookSecret } : {}),
  }
  const set = {
    webhookUrl: targetWebhookUrl,
    ...(webhookSecret ? { webhookSecret } : {}),
  }
  await ctx.pgDb
    .insert(subscriptionWebhooks)
    .values(values)
    .onConflictDoUpdate({
      target: [
        subscriptionWebhooks.tenantId,
        subscriptionWebhooks.subscriptionId,
      ],
      set,
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
  streamPath: string
): string {
  const prefix = requestUrl.pathname.slice(
    0,
    requestUrl.pathname.indexOf(`/streams/`) + `/streams/`.length
  )
  requestUrl.pathname = `${prefix}${encodeURIComponent(
    normalizeSubscriptionPath(streamPath)
  )}`
  return requestUrl.toString()
}

async function putSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const rewrite = await rewriteSubscriptionRequestBody(
    request,
    ctx,
    subscriptionId
  )
  if (!rewrite.ok) return rewrite.response

  const { upstream, response, responseBytes } =
    await forwardSubscriptionRequest(request, ctx, { body: rewrite.body })
  if (upstream.ok && rewrite.targetWebhookUrl) {
    await upsertSubscriptionWebhook(
      ctx,
      subscriptionId,
      rewrite.targetWebhookUrl,
      webhookSecretFromSubscriptionResponse(responseBytes)
    )
  }
  return response
}

async function getSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  return (await forwardSubscriptionRequest(request, ctx)).response
}

async function deleteSubscriptionBase(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const subscriptionId = routeParam(request, `subscriptionId`)
  const { upstream, response } = await forwardSubscriptionRequest(request, ctx)
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
  const rewrite = await rewriteSubscriptionRequestBody(
    request,
    ctx,
    subscriptionId
  )
  if (!rewrite.ok) return rewrite.response

  return (
    await forwardSubscriptionRequest(request, ctx, {
      body: rewrite.body,
    })
  ).response
}

async function deleteSubscriptionStream(
  request: IRequest,
  ctx: TenantContext
): Promise<Response> {
  const requestUrl = rewriteSubscriptionStreamPathInUrl(
    new URL(request.url),
    routeParam(request, `streamPath`)
  )
  return (
    await forwardSubscriptionRequest(request, ctx, {
      requestUrl,
    })
  ).response
}

function subscriptionAction(action: SubscriptionControlAction) {
  return async (request: IRequest, ctx: TenantContext): Promise<Response> => {
    const subscriptionId = routeParam(request, `subscriptionId`)
    const rewrite = await rewriteSubscriptionRequestBody(
      request,
      ctx,
      subscriptionId
    )
    if (!rewrite.ok) return rewrite.response

    const bearerMode =
      action === `ack` || action === `release` || action === `callback`
        ? `if-missing`
        : `overwrite`
    return (
      await forwardSubscriptionRequest(request, ctx, {
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
        serviceId: ctx.service,
        durableStreamsBearer: ctx.durableStreamsBearer,
        durableStreamsBearerMode: `overwrite`,
        durableStreamsRouting: ctx.durableStreamsRouting,
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
