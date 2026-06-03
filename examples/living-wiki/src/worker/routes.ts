import { ZodError, type ZodSchema } from 'zod'
import {
  createSpaceInputSchema,
  getSpaceInputSchema,
  joinSpaceInputSchema,
} from '../shared/space'
import type { ErrorResponse, HealthResponse } from '../shared/types'
import { submitSourceCommandSchema } from '../shared/wiki-state-sources'
import { getElectricCloudConfig } from './electric-cloud'
import { isSeededDemoEnabled, type WorkerEnv } from './env'
import {
  getWikiSpaceStore,
  WikiSpaceActorNotFoundError,
  WikiSpaceNotFoundError,
} from './wiki-space-store'
import { getWikiStateProducer } from './wiki-state-producer'

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

const badRequest = (message: string): Response =>
  json({ ok: false, error: message }, { status: 400 })

async function parseJsonBody(request: Request): Promise<unknown | Response> {
  try {
    return await request.json()
  } catch {
    return badRequest(`Invalid JSON`)
  }
}

const parseInput = <T>(schema: ZodSchema<T>, input: unknown): T | Response => {
  const result = schema.safeParse(input)

  if (!result.success) {
    return badRequest(`Invalid input`)
  }

  return result.data
}

const handleRestSpaceError = (error: unknown): Response => {
  if (error instanceof WikiSpaceNotFoundError) {
    return json({ ok: false, error: `Space not found` }, { status: 404 })
  }

  if (error instanceof WikiSpaceActorNotFoundError) {
    return json({ ok: false, error: `Actor not found` }, { status: 404 })
  }

  if (error instanceof ZodError) {
    return badRequest(`Invalid input`)
  }

  throw error
}

export async function handleRestRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | undefined> {
  const url = new URL(request.url)

  if (url.pathname === `/api/health` && request.method === `GET`) {
    return json(healthResponse(env))
  }

  if (url.pathname === `/api/spaces` && request.method === `POST`) {
    const body = await parseJsonBody(request)
    if (body instanceof Response) return body

    const input = parseInput(createSpaceInputSchema, body)
    if (input instanceof Response) return input

    try {
      const snapshot = await getWikiSpaceStore(env).createSpace(input)
      getWikiStateProducer().bootstrapSpace(snapshot)
      return json(snapshot)
    } catch (error) {
      return handleRestSpaceError(error)
    }
  }

  const joinMatch = url.pathname.match(/^\/api\/spaces\/([^/]+)\/join$/)
  if (joinMatch && request.method === `POST`) {
    const body = await parseJsonBody(request)
    if (body instanceof Response) return body

    const input = parseInput(joinSpaceInputSchema, {
      ...(typeof body === `object` && body !== null ? body : {}),
      wikiSpaceId: joinMatch[1],
    })
    if (input instanceof Response) return input

    try {
      const snapshot = await getWikiSpaceStore(env).joinSpace(input)
      getWikiStateProducer().recordJoin(snapshot)
      return json(snapshot)
    } catch (error) {
      return handleRestSpaceError(error)
    }
  }

  const sourceMatch = url.pathname.match(/^\/api\/spaces\/([^/]+)\/sources$/)
  if (sourceMatch && request.method === `POST`) {
    const body = await parseJsonBody(request)
    if (body instanceof Response) return body

    const input = parseInput(submitSourceCommandSchema, {
      ...(typeof body === `object` && body !== null ? body : {}),
      wikiSpaceId: sourceMatch[1],
    })
    if (input instanceof Response) return input

    try {
      await getWikiSpaceStore(env).getSpace({
        wikiSpaceId: input.wikiSpaceId,
        actorId: input.actorId,
      })
      const result = getWikiStateProducer().submitSource(input)
      return json({
        source: result.source,
        activityEventId: result.activityEvent.id,
      })
    } catch (error) {
      return handleRestSpaceError(error)
    }
  }

  const sharedStateMatch = url.pathname.match(
    /^\/api\/spaces\/([^/]+)\/shared-state-snapshot$/
  )
  if (sharedStateMatch && request.method === `GET`) {
    const input = parseInput(
      getSpaceInputSchema.shape.wikiSpaceId,
      sharedStateMatch[1]
    )
    if (input instanceof Response) return input

    try {
      await getWikiSpaceStore(env).getSpace({ wikiSpaceId: input })
      return json(getWikiStateProducer().getRows(input))
    } catch (error) {
      return handleRestSpaceError(error)
    }
  }

  const getMatch = url.pathname.match(/^\/api\/spaces\/([^/]+)$/)
  if (getMatch && request.method === `GET`) {
    const input = parseInput(getSpaceInputSchema, {
      wikiSpaceId: getMatch[1],
      ...(url.searchParams.has(`actorId`)
        ? { actorId: url.searchParams.get(`actorId`) }
        : {}),
    })
    if (input instanceof Response) return input

    try {
      return json(await getWikiSpaceStore(env).getSpace(input))
    } catch (error) {
      return handleRestSpaceError(error)
    }
  }

  if (url.pathname.startsWith(`/api/`)) {
    const body: ErrorResponse = { ok: false, error: `Not found` }
    return json(body, { status: 404 })
  }

  return undefined
}
