import { handleRestRequest } from './routes'
import type { WorkerEnv } from './env'

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    _ctx?: ExecutionContext
  ): Promise<Response> {
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
