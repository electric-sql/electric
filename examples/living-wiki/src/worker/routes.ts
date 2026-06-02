import type { ErrorResponse, HealthResponse } from '../shared/types'
import { getElectricCloudConfig } from './electric-cloud'
import { isSeededDemoEnabled, type WorkerEnv } from './env'

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': `application/json; charset=utf-8`,
      ...(init?.headers ?? {}),
    },
  })
}

export function healthResponse(env: WorkerEnv): HealthResponse {
  const electric = getElectricCloudConfig(env)

  return {
    ok: true,
    app: `living-wiki`,
    env: env.APP_ENV,
    electricCloudConfigured: electric.hasToken,
    electricAgentsSpaceId: electric.agentsSpaceId,
    seededDemoEnabled: isSeededDemoEnabled(env),
  }
}

export async function handleRestRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | undefined> {
  const url = new URL(request.url)

  if (url.pathname === `/api/health` && request.method === `GET`) {
    return json(healthResponse(env))
  }

  if (url.pathname.startsWith(`/api/`)) {
    const body: ErrorResponse = { ok: false, error: `Not found` }
    return json(body, { status: 404 })
  }

  return undefined
}
