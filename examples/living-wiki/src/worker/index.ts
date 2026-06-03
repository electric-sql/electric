import { handleAgentsProxyRequest } from './agents-proxy/routes'
import { handleRestRequest } from './routes'
import { handleTrpcRequest } from './trpc-router'
import type { WorkerEnv } from './env'

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    _ctx?: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === `/trpc` || url.pathname.startsWith(`/trpc/`)) {
      return handleTrpcRequest(request, env)
    }

    const agentsProxyResponse = await handleAgentsProxyRequest(request, env)
    if (agentsProxyResponse) return agentsProxyResponse

    const restResponse = await handleRestRequest(request, env)
    if (restResponse) return restResponse

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response(`Living Wiki API`, {
      headers: { 'content-type': `text/plain; charset=utf-8` },
    })
  },
}
