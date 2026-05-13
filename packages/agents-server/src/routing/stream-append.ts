/**
 * HTTP routing for durable stream appends that affect Electric Agents state.
 */

import { Router } from 'itty-router'
import { apiError, readRequestBody } from '../electric-agents-http.js'
import {
  ErrCodeForkInProgress,
  ErrCodeNotRunning,
  ErrCodeUnauthorized,
} from '../electric-agents-types.js'
import { serverLog } from '../utils/log.js'
import type { EntityManager } from '../entity-manager.js'
import type { IRequest, RouterType } from 'itty-router'

type StreamAppendEvent =
  | Record<string, unknown>
  | Array<Record<string, unknown>>

export interface ElectricAgentsStreamAppendRouteRequest extends IRequest {
  method: string
  url: string
  headers: Headers
  readBody(): Promise<Uint8Array>
}

export interface ElectricAgentsStreamAppendRuntime {
  manager: EntityManager
  evaluateWakePayload(
    sourceUrl: string,
    event: StreamAppendEvent
  ): Promise<void>
  checkRunFinished(sourceUrl: string, event: StreamAppendEvent): void
  syncManifestWakes(
    subscriberUrl: string,
    event: StreamAppendEvent
  ): Promise<void>
  syncManifestEntitySources(
    ownerEntityUrl: string,
    event: StreamAppendEvent
  ): Promise<void>
  syncManifestSchedules(
    ownerEntityUrl: string,
    event: StreamAppendEvent
  ): Promise<void>
}

export type DurableStreamsAppendForwarder = (
  request: ElectricAgentsStreamAppendRouteRequest,
  body: Uint8Array
) => Promise<Response>

type StreamAppendRouteArgs = [
  ElectricAgentsStreamAppendRuntime,
  DurableStreamsAppendForwarder,
]
type StreamAppendRouteResult = Response | undefined

export type ElectricAgentsStreamAppendRoutes = RouterType<
  ElectricAgentsStreamAppendRouteRequest,
  StreamAppendRouteArgs,
  StreamAppendRouteResult
>

export const electricAgentsStreamAppendRouter: ElectricAgentsStreamAppendRoutes =
  Router<
    ElectricAgentsStreamAppendRouteRequest,
    StreamAppendRouteArgs,
    StreamAppendRouteResult
  >()

electricAgentsStreamAppendRouter.post(`*`, handleStreamAppend)

export function createStreamAppendRouteRequest(
  request: Request
): ElectricAgentsStreamAppendRouteRequest {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    readBody: () => readRequestBody(request),
  } as ElectricAgentsStreamAppendRouteRequest
}

async function handleStreamAppend(
  request: ElectricAgentsStreamAppendRouteRequest,
  runtime: ElectricAgentsStreamAppendRuntime,
  forward: DurableStreamsAppendForwarder
): Promise<StreamAppendRouteResult> {
  const path = new URL(request.url).pathname
  const { manager } = runtime
  const entity = await manager.registry.getEntityByStream(path)
  const isSharedState = path.startsWith(`/_electric/shared-state/`)
  if (!entity && !isSharedState) {
    return undefined
  }

  const body = await request.readBody()
  const event = decodeStreamAppendEvent(body)

  if (entity) {
    const token = writeTokenFromHeaders(request.headers)
    if (!manager.isValidWriteToken(entity, token)) {
      return apiError(401, ErrCodeUnauthorized, `Invalid write token`)
    }
    if (manager.isForkWriteLockedEntity(entity.url)) {
      return apiError(
        409,
        ErrCodeForkInProgress,
        `Entity subtree is being forked`
      )
    }
    if (entity.status === `stopped`) {
      return apiError(409, ErrCodeNotRunning, `Entity is stopped`)
    }

    if (event) {
      const events = Array.isArray(event) ? event : [event]
      for (const eventItem of events) {
        const validationError = await manager.validateWriteEvent(
          entity,
          eventItem
        )
        if (validationError) {
          return apiError(
            validationError.status,
            validationError.code,
            validationError.message
          )
        }
      }
    }
  } else if (manager.isForkWriteLockedStream(path)) {
    return apiError(
      409,
      ErrCodeForkInProgress,
      `Entity subtree is being forked`
    )
  }

  const upstream = await forward(request, body)
  if (!upstream.ok || !event) {
    return upstream
  }

  if (entity) {
    void runtime
      .evaluateWakePayload(entity.url, event)
      .catch((err) =>
        serverLog.warn(`[agent-server] wake evaluation failed:`, err)
      )
    runtime.checkRunFinished(entity.url, event)
    void runtime
      .syncManifestWakes(entity.url, event)
      .catch((err) =>
        serverLog.warn(`[agent-server] manifest wake sync failed:`, err)
      )
    void runtime
      .syncManifestEntitySources(entity.url, event)
      .catch((err) =>
        serverLog.warn(`[agent-server] manifest source sync failed:`, err)
      )
    void runtime
      .syncManifestSchedules(entity.url, event)
      .catch((err) =>
        serverLog.warn(`[agent-server] manifest schedule sync failed:`, err)
      )
  } else {
    void runtime
      .evaluateWakePayload(path, event)
      .catch((err) =>
        serverLog.warn(`[agent-server] wake evaluation failed:`, err)
      )
  }

  return upstream
}

function decodeStreamAppendEvent(body: Uint8Array): StreamAppendEvent | null {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as StreamAppendEvent
  } catch {
    return null
  }
}

function writeTokenFromHeaders(headers: Headers): string {
  const electricClaimToken = headers.get(`electric-claim-token`)?.trim()
  if (electricClaimToken) return electricClaimToken
  return (
    headers
      .get(`authorization`)
      ?.replace(/^Bearer\s+/i, ``)
      .trim() ?? ``
  )
}
