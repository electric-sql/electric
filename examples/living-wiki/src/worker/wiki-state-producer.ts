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
  getRows(wikiSpaceId: string): WikiStateSnapshotRows
}

type SpaceRows = {
  wikiSpaces: Map<string, WikiSpaceRow>
  actors: Map<string, ActorRow>
  memberships: Map<string, MembershipRow>
  activityEvents: Map<string, ActivityEventRow>
  sources: Map<string, SourceRow>
}

const spaces = new Map<string, SpaceRows>()

const emptyRows = (): SpaceRows => ({
  wikiSpaces: new Map(),
  actors: new Map(),
  memberships: new Map(),
  activityEvents: new Map(),
  sources: new Map(),
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
  wiki_pages: [],
  wiki_links: [],
  review_items: [],
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

  getRows(wikiSpaceId: string): WikiStateSnapshotRows {
    return toSnapshotRows(getSpaceRows(wikiSpaceId))
  }
}

export const getWikiStateProducer = (): WikiStateProducer =>
  new LocalDemoWikiStateProducer()

export const resetLocalDemoWikiStateProducerForTests = (): void => {
  spaces.clear()
}
