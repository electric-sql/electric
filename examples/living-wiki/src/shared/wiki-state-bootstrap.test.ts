import { describe, expect, it } from 'vitest'

import { wikiSpaceSnapshotSchema, type WikiSpaceSnapshot } from './space'
import {
  activityEventSchema,
  actorSchema,
  membershipSchema,
  wikiSpaceSchema,
} from './wiki-state'
import {
  buildWikiStateBootstrapRows,
  buildWikiStateJoinRows,
} from './wiki-state-bootstrap'
import { createMembershipId } from './wiki-state-ids'

const fixedNow = () => new Date(`2026-06-03T12:00:00.000Z`)

const snapshot: WikiSpaceSnapshot = {
  space: {
    id: `wiki_demo`,
    title: `Demo Wiki`,
    createdAt: `2026-06-03T10:00:00.000Z`,
    createdByActorId: `actor_owner`,
    memberCount: 2,
  },
  currentActor: {
    id: `actor_member`,
    wikiSpaceId: `wiki_demo`,
    kind: `human`,
    displayName: `Member`,
    avatarColor: `blue`,
    createdAt: `2026-06-03T11:00:00.000Z`,
  },
  actors: [
    {
      id: `actor_owner`,
      wikiSpaceId: `wiki_demo`,
      kind: `human`,
      displayName: `Owner`,
      avatarColor: `green`,
      createdAt: `2026-06-03T10:00:00.000Z`,
    },
    {
      id: `actor_member`,
      wikiSpaceId: `wiki_demo`,
      kind: `human`,
      displayName: `Member`,
      avatarColor: `blue`,
      createdAt: `2026-06-03T11:00:00.000Z`,
    },
  ],
}

describe(`living wiki bootstrap row builders`, () => {
  it(`builds valid space, actors, memberships, and create event rows`, () => {
    const rows = buildWikiStateBootstrapRows(snapshot, {
      now: fixedNow,
      createEventSeed: `create-demo`,
    })

    expect(wikiSpaceSchema.safeParse(rows.wikiSpace).success).toBe(true)
    expect(rows.actors.every((row) => actorSchema.safeParse(row).success)).toBe(
      true
    )
    expect(
      rows.memberships.every((row) => membershipSchema.safeParse(row).success)
    ).toBe(true)
    expect(
      rows.activityEvents.every(
        (row) => activityEventSchema.safeParse(row).success
      )
    ).toBe(true)
    expect(rows.wikiSpace).toMatchObject({
      id: `wiki_demo`,
      status: `active`,
      created_at: `2026-06-03T10:00:00.000Z`,
    })
  })

  it(`uses deterministic membership and event ids`, () => {
    const rows = buildWikiStateBootstrapRows(snapshot, {
      now: fixedNow,
      createEventSeed: `space-created-wiki-demo`,
    })

    expect(rows.memberships.map((row) => row.id)).toEqual([
      createMembershipId(`wiki_demo`, `actor_owner`),
      createMembershipId(`wiki_demo`, `actor_member`),
    ])
    expect(rows.activityEvents[0]?.id).toBe(`event_space-created-wiki-demo`)
    expect(rows.activityEvents[0]?.occurred_at).toBe(`2026-06-03T12:00:00.000Z`)
  })

  it(`assigns owner membership to creator and member membership to joins`, () => {
    const rows = buildWikiStateBootstrapRows(snapshot)

    expect(rows.memberships).toContainEqual(
      expect.objectContaining({ actor_id: `actor_owner`, role: `owner` })
    )
    expect(rows.memberships).toContainEqual(
      expect.objectContaining({ actor_id: `actor_member`, role: `member` })
    )
  })

  it(`builds member join rows with ambient summary`, () => {
    const rows = buildWikiStateJoinRows(snapshot, snapshot.currentActor, {
      now: fixedNow,
      eventSeed: `join-member`,
    })

    expect(rows.actors).toHaveLength(1)
    expect(rows.memberships[0]).toMatchObject({
      actor_id: `actor_member`,
      role: `member`,
      joined_at: `2026-06-03T11:00:00.000Z`,
    })
    expect(rows.activityEvents[0]).toMatchObject({
      id: `event_join-member`,
      event_type: `space_joined`,
      summary: `Member joined the wiki`,
      visibility: `ambient`,
    })
  })

  it(`deduplicates duplicate actors in snapshot rows`, () => {
    const rows = buildWikiStateBootstrapRows({
      ...snapshot,
      actors: [...snapshot.actors, snapshot.actors[1]!],
    })

    expect(rows.actors).toHaveLength(2)
    expect(rows.memberships).toHaveLength(2)
  })

  it(`parses snapshot-like input through shared schema and rejects bad ids`, () => {
    expect(wikiSpaceSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(() =>
      buildWikiStateBootstrapRows({
        ...snapshot,
        space: { ...snapshot.space, id: `bad` },
      })
    ).toThrow()
  })
})
