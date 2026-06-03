import { z } from 'zod'
import {
  wikiSpaceSnapshotSchema,
  type CreateSpaceInput,
  type GetSpaceInput,
  type JoinSpaceInput,
  type WikiSpaceSnapshot,
} from '../../shared/space'
import {
  activityEventSchema,
  actorSchema,
  membershipSchema,
  reviewItemSchema,
  sourceSchema,
  wikiLinkSchema,
  wikiPageSchema,
  wikiSpaceSchema,
  type ActivityEventRow,
  type ActorRow,
  type MembershipRow,
  type AgentRunRow,
  type ReviewItemRow,
  type SourceRow,
  type WikiLinkRow,
  type WikiPageRow,
  type WikiSpaceRow,
} from '../../shared/wiki-state'
import {
  submitSourceCommandSchema,
  type SubmitSourceCommand,
} from '../../shared/wiki-state-sources'

export class LivingWikiApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = `LivingWikiApiError`
    this.status = status
  }
}

export type LivingWikiSharedStateSnapshot = {
  wiki_spaces: WikiSpaceRow[]
  actors: ActorRow[]
  memberships: MembershipRow[]
  activity_events: ActivityEventRow[]
  sources: SourceRow[]
  wiki_pages: WikiPageRow[]
  wiki_links: WikiLinkRow[]
  review_items: ReviewItemRow[]
  agent_runs: AgentRunRow[]
}

export type SubmitSourceResult = {
  source: SourceRow
  activityEventId: string
}

const livingWikiSharedStateSnapshotSchema = z.object({
  wiki_spaces: z.array(wikiSpaceSchema),
  actors: z.array(actorSchema),
  memberships: z.array(membershipSchema),
  activity_events: z.array(activityEventSchema),
  sources: z.array(sourceSchema),
  wiki_pages: z.array(wikiPageSchema),
  wiki_links: z.array(wikiLinkSchema),
  review_items: z.array(reviewItemSchema),
  agent_runs: z.array(z.never()),
})

const submitSourceResultSchema = z.object({
  source: sourceSchema,
  activityEventId: z.string().regex(/^event_[a-z0-9_-]+$/),
})

export type LivingWikiApiClient = {
  createSpace(input: CreateSpaceInput): Promise<WikiSpaceSnapshot>
  joinSpace(input: JoinSpaceInput): Promise<WikiSpaceSnapshot>
  getSpace(input: GetSpaceInput): Promise<WikiSpaceSnapshot>
  getSharedStateSnapshot(input: {
    wikiSpaceId: string
  }): Promise<LivingWikiSharedStateSnapshot>
  submitSource(input: SubmitSourceCommand): Promise<SubmitSourceResult>
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

async function parseJsonResponse<T>(
  response: Response,
  schema: z.ZodSchema<T>,
  invalidMessage: string
): Promise<T> {
  const body = await readJson(response)

  if (!response.ok) {
    throw new LivingWikiApiError(
      response.status,
      errorMessageFromBody(body, response.statusText || `Request failed`)
    )
  }

  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    throw new LivingWikiApiError(response.status, invalidMessage)
  }

  return parsed.data
}

async function parseSnapshotResponse(
  response: Response
): Promise<WikiSpaceSnapshot> {
  return parseJsonResponse(
    response,
    wikiSpaceSnapshotSchema,
    `Invalid space response`
  )
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

    async getSharedStateSnapshot(input) {
      return parseJsonResponse(
        await fetchImpl(
          url(
            `/api/spaces/${encodeURIComponent(input.wikiSpaceId)}/shared-state-snapshot`
          ),
          { method: `GET` }
        ),
        livingWikiSharedStateSnapshotSchema,
        `Invalid shared state response`
      )
    },

    async submitSource(input) {
      const parsed = submitSourceCommandSchema.parse(input)
      const { wikiSpaceId, ...body } = parsed
      return parseJsonResponse(
        await fetchImpl(
          url(`/api/spaces/${encodeURIComponent(wikiSpaceId)}/sources`),
          {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify(body),
          }
        ),
        submitSourceResultSchema,
        `Invalid source response`
      )
    },
  }
}
