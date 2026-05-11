/**
 * OSS server-only wrapper routes.
 *
 * The exported global router stays library-safe. The standalone OSS server adds
 * its dashboard and optional mock-agent handler here before falling through to
 * the global router.
 */

import { AutoRouter, status } from 'itty-router'
import { agentUiRouter } from './agent-ui-router.js'
import { globalRouter } from './global-router.js'
import { applyCors, errorMapper, preflightCors } from './hooks.js'
import type { RuntimeHandler } from '@electric-ax/agents-runtime'
import type { AutoRouterType, IRequest } from 'itty-router'
import type { TenantContext } from './context.js'

export interface OssServerContext extends TenantContext {
  mockAgent?: { runtime: RuntimeHandler }
}

export type OssServerRoutes = AutoRouterType<
  IRequest,
  [OssServerContext],
  Response
>

export const ossServerRouter: OssServerRoutes = AutoRouter<
  IRequest,
  [OssServerContext],
  Response
>({
  before: [preflightCors],
  catch: errorMapper,
  finally: [applyCors],
})

ossServerRouter.get(`/`, redirectToAgentUi)
ossServerRouter.head(`/`, redirectToAgentUi)
ossServerRouter.all(`/__agent_ui/*`, agentUiRouter.fetch)
ossServerRouter.post(`/_electric/mock-agent-handler`, mockAgentHandler)
ossServerRouter.all(`*`, (request, ctx) => globalRouter.fetch(request, ctx))

function redirectToAgentUi(): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `/__agent_ui/` },
  })
}

async function mockAgentHandler(
  request: IRequest,
  ctx: OssServerContext
): Promise<Response> {
  if (!ctx.mockAgent) return status(404)
  return await ctx.mockAgent.runtime.handleWebhookRequest(request as Request)
}
