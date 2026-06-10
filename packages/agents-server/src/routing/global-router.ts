/**
 * Library-safe top-level HTTP router for agents-server.
 */

import { AutoRouter, withParams } from 'itty-router'
import { durableStreamsRouter } from './durable-streams-router.js'
import { internalRouter } from './internal-router.js'
import {
  applyCors,
  errorMapper,
  otelEndSpan,
  otelStartSpan,
  preflightCors,
  rejectIfShuttingDown,
} from './hooks.js'
import type { AutoRouterType, IRequest } from 'itty-router'
import type { TenantContext } from './context.js'

export type GlobalRoutes = AutoRouterType<IRequest, [TenantContext], Response>

export const globalRouter: GlobalRoutes = AutoRouter<
  IRequest,
  [TenantContext],
  Response
>({
  before: [preflightCors, withParams, otelStartSpan, rejectIfShuttingDown],
  catch: errorMapper,
  finally: [otelEndSpan, applyCors],
})

globalRouter.all(`/_electric/shared-state/*`, durableStreamsRouter.fetch)
globalRouter.all(`/_electric/pg-sync/register`, internalRouter.fetch)
globalRouter.get(`/_electric/pg-sync/*`, durableStreamsRouter.fetch)
globalRouter.head(`/_electric/pg-sync/*`, durableStreamsRouter.fetch)
globalRouter.all(`/_electric/*`, internalRouter.fetch)
globalRouter.all(`*`, durableStreamsRouter.fetch)
