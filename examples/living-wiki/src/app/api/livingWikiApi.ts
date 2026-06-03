import {
  wikiSpaceSnapshotSchema,
  type CreateSpaceInput,
  type GetSpaceInput,
  type JoinSpaceInput,
  type WikiSpaceSnapshot,
} from '../../shared/space'

export class LivingWikiApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = `LivingWikiApiError`
    this.status = status
  }
}

export type LivingWikiApiClient = {
  createSpace(input: CreateSpaceInput): Promise<WikiSpaceSnapshot>
  joinSpace(input: JoinSpaceInput): Promise<WikiSpaceSnapshot>
  getSpace(input: GetSpaceInput): Promise<WikiSpaceSnapshot>
}

type LivingWikiApiClientOptions = {
  baseUrl?: string
  fetch?: typeof fetch
}

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, ``)

const createUrlBuilder = (baseUrl = ``) => {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl)

  return (path: string): string => `${normalizedBaseUrl}${path}`
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

const errorMessageFromBody = (body: unknown, fallback: string): string => {
  if (typeof body === `object` && body !== null) {
    const record = body as Record<string, unknown>

    if (typeof record.error === `string` && record.error.length > 0) {
      return record.error
    }

    if (typeof record.message === `string` && record.message.length > 0) {
      return record.message
    }
  }

  return fallback
}

async function parseSnapshotResponse(
  response: Response
): Promise<WikiSpaceSnapshot> {
  const body = await readJson(response)

  if (!response.ok) {
    throw new LivingWikiApiError(
      response.status,
      errorMessageFromBody(body, response.statusText || `Request failed`)
    )
  }

  const parsed = wikiSpaceSnapshotSchema.safeParse(body)

  if (!parsed.success) {
    throw new LivingWikiApiError(response.status, `Invalid space response`)
  }

  return parsed.data
}

export function createLivingWikiApiClient(
  options: LivingWikiApiClientOptions = {}
): LivingWikiApiClient {
  const fetchImpl = options.fetch ?? fetch
  const url = createUrlBuilder(options.baseUrl ?? ``)

  return {
    async createSpace(input) {
      return parseSnapshotResponse(
        await fetchImpl(url(`/api/spaces`), {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify(input),
        })
      )
    },

    async joinSpace(input) {
      const { wikiSpaceId, ...body } = input

      return parseSnapshotResponse(
        await fetchImpl(
          url(`/api/spaces/${encodeURIComponent(wikiSpaceId)}/join`),
          {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify(body),
          }
        )
      )
    },

    async getSpace(input) {
      const query = input.actorId
        ? `?actorId=${encodeURIComponent(input.actorId)}`
        : ``

      return parseSnapshotResponse(
        await fetchImpl(
          url(`/api/spaces/${encodeURIComponent(input.wikiSpaceId)}${query}`),
          {
            method: `GET`,
          }
        )
      )
    },
  }
}
