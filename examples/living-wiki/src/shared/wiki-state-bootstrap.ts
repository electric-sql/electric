import {
  wikiSpaceSnapshotSchema,
  type DemoActor,
  type WikiSpaceSnapshot,
} from './space'
import {
  activityEventSchema,
  actorSchema as sharedActorSchema,
  membershipSchema as sharedMembershipSchema,
  wikiSpaceSchema as sharedWikiSpaceSchema,
  type ActivityEventRow,
  type ActorRow,
  type MembershipRow,
  type WikiSpaceRow,
} from './wiki-state'
import { createActivityEventId, createMembershipId } from './wiki-state-ids'

export type BuildWikiStateBootstrapRowsOptions = {
  now?: () => Date
  createEventSeed?: string
}

export type WikiStateBootstrapRows = {
  wikiSpace: WikiSpaceRow
  actors: ActorRow[]
  memberships: MembershipRow[]
  activityEvents: ActivityEventRow[]
}

export type BuildWikiStateJoinRowsOptions = {
  now?: () => Date
  eventSeed?: string
}

export function buildWikiStateBootstrapRows(
  snapshot: WikiSpaceSnapshot,
  options: BuildWikiStateBootstrapRowsOptions = {}
): WikiStateBootstrapRows {
  const parsed = wikiSpaceSnapshotSchema.parse(snapshot)
  const actors = uniqueActors(parsed.actors).map(buildActorRow)
  const memberships = actors.map((actor) =>
    buildMembershipRow(actor, parsed.space.createdByActorId)
  )
  const creator = actors.find(
    (actor) => actor.id === parsed.space.createdByActorId
  )
  if (!creator) throw new Error(`Space creator must be present in actors`)

  return {
    wikiSpace: sharedWikiSpaceSchema.parse({
      id: parsed.space.id,
      title: parsed.space.title,
      created_at: parsed.space.createdAt,
      created_by_actor_id: parsed.space.createdByActorId,
      status: `active`,
    }),
    actors,
    memberships,
    activityEvents: [
      buildSpaceCreatedActivityEvent(parsed, creator, {
        now: options.now,
        eventSeed: options.createEventSeed,
      }),
    ],
  }
}

export function buildWikiStateJoinRows(
  snapshot: WikiSpaceSnapshot,
  actor: DemoActor = snapshot.currentActor,
  options: BuildWikiStateJoinRowsOptions = {}
): Pick<WikiStateBootstrapRows, `actors` | `memberships` | `activityEvents`> {
  const parsedSnapshot = wikiSpaceSnapshotSchema.parse(snapshot)
  const parsedActor = wikiSpaceSnapshotSchema.shape.currentActor.parse(actor)
  if (parsedActor.wikiSpaceId !== parsedSnapshot.space.id) {
    throw new Error(`Join actor must belong to the space`)
  }

  const actorRow = buildActorRow(parsedActor)
  return {
    actors: [actorRow],
    memberships: [
      buildMembershipRow(actorRow, parsedSnapshot.space.createdByActorId),
    ],
    activityEvents: [
      buildSpaceJoinedActivityEvent(parsedSnapshot.space.id, actorRow, options),
    ],
  }
}

function buildActorRow(actor: DemoActor): ActorRow {
  return sharedActorSchema.parse({
    id: actor.id,
    wiki_space_id: actor.wikiSpaceId,
    kind: actor.kind,
    display_name: actor.displayName,
    avatar_color: actor.avatarColor,
    created_at: actor.createdAt,
  })
}

function buildMembershipRow(
  actor: ActorRow,
  creatorActorId: string
): MembershipRow {
  return sharedMembershipSchema.parse({
    id: createMembershipId(actor.wiki_space_id, actor.id),
    wiki_space_id: actor.wiki_space_id,
    actor_id: actor.id,
    role: actor.id === creatorActorId ? `owner` : `member`,
    joined_at: actor.created_at,
    status: `active`,
  })
}

function buildSpaceCreatedActivityEvent(
  snapshot: ReturnType<typeof wikiSpaceSnapshotSchema.parse>,
  creator: ActorRow,
  options: { now?: () => Date; eventSeed?: string }
): ActivityEventRow {
  return activityEventSchema.parse({
    id: createActivityEventId(options.eventSeed),
    wiki_space_id: snapshot.space.id,
    occurred_at: (
      options.now?.() ?? new Date(snapshot.space.createdAt)
    ).toISOString(),
    actor_id: creator.id,
    actor_kind: `human`,
    event_type: `space_created`,
    summary: `${creator.display_name} created ${snapshot.space.title}`,
    subject_type: `wiki_space`,
    subject_id: snapshot.space.id,
    visibility: `ambient`,
    metadata: { title: snapshot.space.title },
  })
}

function buildSpaceJoinedActivityEvent(
  wikiSpaceId: string,
  actor: ActorRow,
  options: { now?: () => Date; eventSeed?: string }
): ActivityEventRow {
  return activityEventSchema.parse({
    id: createActivityEventId(options.eventSeed),
    wiki_space_id: wikiSpaceId,
    occurred_at: (options.now?.() ?? new Date(actor.created_at)).toISOString(),
    actor_id: actor.id,
    actor_kind: `human`,
    event_type: `space_joined`,
    summary: `${actor.display_name} joined the wiki`,
    subject_type: `actor`,
    subject_id: actor.id,
    visibility: `ambient`,
    metadata: {},
  })
}

function uniqueActors(actors: DemoActor[]): DemoActor[] {
  const seen = new Set<string>()
  return actors.filter((actor) => {
    if (seen.has(actor.id)) return false
    seen.add(actor.id)
    return true
  })
}
