import type {
  ActivityEventRow,
  ActorRow,
  AgentRunRow,
  MembershipRow,
  ReviewItemRow,
  SourceRow,
  WikiLinkRow,
  WikiPageRow,
  WikiSpaceRow,
} from '../shared/wiki-state'
import {
  buildWikiStateBootstrapRows,
  buildWikiStateJoinRows,
  type WikiStateBootstrapRows,
} from '../shared/wiki-state-bootstrap'
import { buildActivityEventRow } from '../shared/wiki-state-events'
import { createActivityEventId } from '../shared/wiki-state-ids'
import { buildWikiPageFromSubmittedSource } from '../shared/wiki-state-pages'
import {
  buildOpenReviewItemForPage,
  resolveReviewItemCommandSchema,
  type ResolveReviewItemCommand,
} from '../shared/wiki-state-reviews'
import {
  buildSourceSubmissionRows,
  type SubmitSourceCommand,
} from '../shared/wiki-state-sources'
import type { DemoActor, WikiSpaceSnapshot } from '../shared/space'

export type WikiStateSnapshotRows = {
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

export type WikiStateProducer = {
  bootstrapSpace(snapshot: WikiSpaceSnapshot): WikiStateSnapshotRows
  recordJoin(
    snapshot: WikiSpaceSnapshot,
    actor?: DemoActor
  ): WikiStateSnapshotRows
  submitSource(command: SubmitSourceCommand): {
    source: SourceRow
    activityEvent: ActivityEventRow
    rows: WikiStateSnapshotRows
  }
  proposePageFromSource(command: ProposePageFromSourceCommand): {
    page: WikiPageRow
    reviewItem: ReviewItemRow
    activityEvent: ActivityEventRow
    rows: WikiStateSnapshotRows
  }
  resolveReviewItem(command: ResolveReviewItemCommand): {
    page: WikiPageRow
    reviewItem: ReviewItemRow
    activityEvent: ActivityEventRow
    rows: WikiStateSnapshotRows
  }
  getRows(wikiSpaceId: string): WikiStateSnapshotRows
}

export type ProposePageFromSourceCommand = {
  wikiSpaceId: string
  actorId: string
  sourceId: string
  title?: string
  slug?: string
  body?: string
}

type SpaceRows = {
  wikiSpaces: Map<string, WikiSpaceRow>
  actors: Map<string, ActorRow>
  memberships: Map<string, MembershipRow>
  activityEvents: Map<string, ActivityEventRow>
  sources: Map<string, SourceRow>
  wikiPages: Map<string, WikiPageRow>
  reviewItems: Map<string, ReviewItemRow>
}

const spaces = new Map<string, SpaceRows>()

const emptyRows = (): SpaceRows => ({
  wikiSpaces: new Map(),
  actors: new Map(),
  memberships: new Map(),
  activityEvents: new Map(),
  sources: new Map(),
  wikiPages: new Map(),
  reviewItems: new Map(),
})

const getSpaceRows = (wikiSpaceId: string): SpaceRows => {
  let rows = spaces.get(wikiSpaceId)
  if (rows === undefined) {
    rows = emptyRows()
    spaces.set(wikiSpaceId, rows)
  }
  return rows
}

const applyBootstrapRows = (
  rows: SpaceRows,
  bootstrap: WikiStateBootstrapRows
): void => {
  rows.wikiSpaces.set(bootstrap.wikiSpace.id, bootstrap.wikiSpace)
  for (const actor of bootstrap.actors) rows.actors.set(actor.id, actor)
  for (const membership of bootstrap.memberships) {
    rows.memberships.set(membership.id, membership)
  }
  for (const event of bootstrap.activityEvents) {
    rows.activityEvents.set(event.id, event)
  }
}

const toSnapshotRows = (rows: SpaceRows): WikiStateSnapshotRows => ({
  wiki_spaces: Array.from(rows.wikiSpaces.values()),
  actors: Array.from(rows.actors.values()),
  memberships: Array.from(rows.memberships.values()),
  activity_events: Array.from(rows.activityEvents.values()).sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at)
  ),
  sources: Array.from(rows.sources.values()),
  wiki_pages: Array.from(rows.wikiPages.values()),
  wiki_links: [],
  review_items: Array.from(rows.reviewItems.values()),
  agent_runs: [],
})

export class LocalDemoWikiStateProducer implements WikiStateProducer {
  bootstrapSpace(snapshot: WikiSpaceSnapshot): WikiStateSnapshotRows {
    const rows = getSpaceRows(snapshot.space.id)
    applyBootstrapRows(
      rows,
      buildWikiStateBootstrapRows(snapshot, {
        createEventSeed: `space-created-${snapshot.space.id}`,
      })
    )
    return toSnapshotRows(rows)
  }

  recordJoin(
    snapshot: WikiSpaceSnapshot,
    actor: DemoActor = snapshot.currentActor
  ): WikiStateSnapshotRows {
    const rows = getSpaceRows(snapshot.space.id)
    applyBootstrapRows(
      rows,
      buildWikiStateBootstrapRows(snapshot, {
        createEventSeed: `space-created-${snapshot.space.id}`,
      })
    )

    const joinRows = buildWikiStateJoinRows(snapshot, actor, {
      eventSeed: `space-joined-${snapshot.space.id}-${actor.id}`,
    })
    for (const actorRow of joinRows.actors)
      rows.actors.set(actorRow.id, actorRow)
    for (const membership of joinRows.memberships) {
      rows.memberships.set(membership.id, membership)
    }
    for (const event of joinRows.activityEvents) {
      rows.activityEvents.set(event.id, event)
    }

    return toSnapshotRows(rows)
  }

  submitSource(command: SubmitSourceCommand): {
    source: SourceRow
    activityEvent: ActivityEventRow
    rows: WikiStateSnapshotRows
  } {
    const sourceRows = buildSourceSubmissionRows(command, {
      sourceSeed: `source-${command.wikiSpaceId}-${command.actorId}-${command.kind}-${
        command.kind === `url` ? command.url : command.title
      }`,
      eventSeed: `source-submitted-${command.wikiSpaceId}-${command.actorId}-${command.title}`,
    })
    const rows = getSpaceRows(command.wikiSpaceId)
    rows.sources.set(sourceRows.source.id, sourceRows.source)
    rows.activityEvents.set(
      sourceRows.activityEvent.id,
      sourceRows.activityEvent
    )
    return {
      source: sourceRows.source,
      activityEvent: sourceRows.activityEvent,
      rows: toSnapshotRows(rows),
    }
  }

  proposePageFromSource(command: ProposePageFromSourceCommand) {
    const rows = getSpaceRows(command.wikiSpaceId)
    const source = rows.sources.get(command.sourceId)
    if (!source) throw new Error(`Source not found`)
    if (source.status !== `submitted`)
      throw new Error(`Source is not submitted`)
    const now = new Date()
    const page = buildWikiPageFromSubmittedSource(source, {
      title: command.title,
      slug: command.slug,
      body: command.body,
      now: () => now,
      pageSeed: `page-${command.wikiSpaceId}-${command.sourceId}`,
    })
    const reviewItem = buildOpenReviewItemForPage(page, source, {
      now: () => now,
      reviewSeed: `review-${command.wikiSpaceId}-${command.sourceId}`,
    })
    const activityEvent = buildActivityEventRow(
      {
        wiki_space_id: command.wikiSpaceId,
        actor_id: command.actorId,
        actor_kind: `human`,
        event_type: `page_proposed`,
        summary: `Proposed page ${page.title} for review`,
        subject_type: `wiki_page`,
        subject_id: page.id,
        visibility: `ambient`,
        metadata: {
          source_id: source.id,
          page_id: page.id,
          review_item_id: reviewItem.id,
        },
      },
      {
        id: createActivityEventId(
          `page-proposed-${command.wikiSpaceId}-${command.sourceId}`
        ),
        now: () => now,
      }
    )
    rows.wikiPages.set(page.id, rows.wikiPages.get(page.id) ?? page)
    rows.reviewItems.set(
      reviewItem.id,
      rows.reviewItems.get(reviewItem.id) ?? reviewItem
    )
    rows.activityEvents.set(activityEvent.id, activityEvent)
    return {
      page: rows.wikiPages.get(page.id)!,
      reviewItem: rows.reviewItems.get(reviewItem.id)!,
      activityEvent,
      rows: toSnapshotRows(rows),
    }
  }

  resolveReviewItem(command: ResolveReviewItemCommand) {
    const parsed = resolveReviewItemCommandSchema.parse(command)
    const rows = getSpaceRows(parsed.wikiSpaceId)
    const review = rows.reviewItems.get(parsed.reviewItemId)
    if (!review) throw new Error(`Review item not found`)
    if (review.status !== `open`)
      throw new Error(`Review item already resolved`)
    const page = rows.wikiPages.get(review.target_id)
    if (!page) throw new Error(`Review page not found`)
    const now = new Date().toISOString()
    const status = parsed.resolution === `approve` ? `approved` : `rejected`
    const pageStatus =
      parsed.resolution === `approve` ? `canonical` : `rejected`
    const reviewItem = {
      ...review,
      status,
      resolved_at: now,
      resolved_by_actor_id: parsed.actorId,
      resolution_note: parsed.note ?? null,
    } as ReviewItemRow
    const nextPage = {
      ...page,
      status: pageStatus,
      updated_at: now,
    } as WikiPageRow
    rows.reviewItems.set(review.id, reviewItem)
    rows.wikiPages.set(page.id, nextPage)
    const activityEvent = buildActivityEventRow(
      {
        wiki_space_id: parsed.wikiSpaceId,
        actor_id: parsed.actorId,
        actor_kind: `human`,
        event_type:
          status === `approved` ? `review_approved` : `review_rejected`,
        summary: `${status === `approved` ? `Approved` : `Rejected`} review for ${page.title}`,
        subject_type: `review_item`,
        subject_id: review.id,
        visibility: `ambient`,
        metadata: {
          page_id: page.id,
          review_item_id: review.id,
          resolution: parsed.resolution,
        },
      },
      {
        id: createActivityEventId(
          `review-${parsed.resolution}-${parsed.wikiSpaceId}-${review.id}`
        ),
        now: () => new Date(now),
      }
    )
    rows.activityEvents.set(activityEvent.id, activityEvent)
    return {
      page: nextPage,
      reviewItem,
      activityEvent,
      rows: toSnapshotRows(rows),
    }
  }

  getRows(wikiSpaceId: string): WikiStateSnapshotRows {
    return toSnapshotRows(getSpaceRows(wikiSpaceId))
  }
}

export const getWikiStateProducer = (): WikiStateProducer =>
  new LocalDemoWikiStateProducer()

export const resetLocalDemoWikiStateProducerForTests = (): void => {
  spaces.clear()
}
