import { ZodError } from 'zod'
import { actorIdSchema } from '../../shared/wiki-state'
import type { WorkerEnv } from '../env'
import {
  getWikiSpaceStore,
  WikiSpaceActorNotFoundError,
  WikiSpaceNotFoundError,
} from '../wiki-space-store'
import {
  AgentsProxyAdapterError,
  AgentsProxyConfigError,
  proxyAgentsStreamRequest,
} from './proxy'
import { resolveEntityMainStreamTarget, resolveObserveTarget } from './targets'

const ENTITY_STREAM_PATTERN =
  /^\/api\/agents\/entities\/([^/]+)\/([^/]+)\/([^/]+)\/stream$/
const OBSERVE_PATTERN = /^\/api\/observe\/([^/]+)\/([^/]+)$/

class AgentsProxyPrincipalError extends Error {
  constructor(message = `Invalid principal actor`) {
    super(message)
    this.name = `AgentsProxyPrincipalError`
  }
}

export async function handleAgentsProxyRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | undefined> {
  const url = new URL(request.url)

  const entityMatch = url.pathname.match(ENTITY_STREAM_PATTERN)
  if (entityMatch) {
    if (request.method !== `GET`) return methodNotAllowed()
    return handleEntityStreamRequest(
      request,
      env,
      entityMatch[1],
      entityMatch[2],
      entityMatch[3]
    )
  }

  const observeMatch = url.pathname.match(OBSERVE_PATTERN)
  if (observeMatch) {
    if (request.method !== `GET`) return methodNotAllowed()
    return handleObserveRequest(request, env, observeMatch[1], observeMatch[2])
  }

  return undefined
}

async function handleEntityStreamRequest(
  request: Request,
  env: WorkerEnv,
  wikiSpaceId: string,
  entityKind: string,
  entityId: string
): Promise<Response> {
  try {
    const decodedWikiSpaceId = decodeURIComponent(wikiSpaceId)
    const target = resolveEntityMainStreamTarget({
      wikiSpaceId: decodedWikiSpaceId,
      entityKind: decodeURIComponent(entityKind),
      entityId: decodeURIComponent(entityId),
    })
    return await proxyAgentsStreamRequest({
      request,
      env,
      target,
      principal: await resolveRequestPrincipal(
        request,
        env,
        decodedWikiSpaceId
      ),
    })
  } catch (error) {
    return handleProxyError(error)
  }
}

async function handleObserveRequest(
  request: Request,
  env: WorkerEnv,
  wikiSpaceId: string,
  observeKind: string
): Promise<Response> {
  try {
    const decodedWikiSpaceId = decodeURIComponent(wikiSpaceId)
    const target = resolveObserveTarget({
      wikiSpaceId: decodedWikiSpaceId,
      observeKind: decodeURIComponent(observeKind),
    })
    return await proxyAgentsStreamRequest({
      request,
      env,
      target,
      principal: await resolveRequestPrincipal(
        request,
        env,
        decodedWikiSpaceId
      ),
    })
  } catch (error) {
    return handleProxyError(error)
  }
}

async function resolveRequestPrincipal(
  request: Request,
  env: WorkerEnv,
  wikiSpaceId: string
): Promise<string | undefined> {
  const actorId = new URL(request.url).searchParams.get(`actorId`)
  if (!actorId) return undefined

  try {
    const snapshot = await getWikiSpaceStore(env).getSpace({
      wikiSpaceId,
      actorId: actorIdSchema.parse(actorId),
    })
    return snapshot.currentActor.displayName
  } catch (error) {
    if (
      error instanceof ZodError ||
      error instanceof WikiSpaceNotFoundError ||
      error instanceof WikiSpaceActorNotFoundError
    ) {
      throw new AgentsProxyPrincipalError()
    }
    throw error
  }
}

function handleProxyError(error: unknown): Response {
  if (error instanceof ZodError || error instanceof AgentsProxyPrincipalError) {
    return errorJson(`Invalid request`, 400)
  }
  if (error instanceof AgentsProxyConfigError) {
    return errorJson(`Agents proxy is not configured`, 503)
  }
  if (error instanceof AgentsProxyAdapterError) {
    return errorJson(`Upstream error`, 502)
  }
  throw error
}

function errorJson(message: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'content-type': `application/json; charset=utf-8` },
  })
}

function methodNotAllowed(): Response {
  return errorJson(`Method not allowed`, 405)
}
