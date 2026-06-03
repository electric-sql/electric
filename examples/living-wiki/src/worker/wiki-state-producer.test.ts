import { beforeEach, describe, expect, it } from 'vitest'
import type { WikiSpaceSnapshot } from '../shared/space'
import {
  getWikiStateProducer,
  resetLocalDemoWikiStateProducerForTests,
} from './wiki-state-producer'

const snapshot: WikiSpaceSnapshot = {
  space: {
    id: `wiki_demo`,
    title: `Demo Space`,
    createdAt: `2026-06-03T12:00:00.000Z`,
    createdByActorId: `actor_alice`,
    memberCount: 1,
  },
  currentActor: {
    id: `actor_alice`,
    wikiSpaceId: `wiki_demo`,
    kind: `human`,
    displayName: `Alice`,
    avatarColor: `blue`,
    createdAt: `2026-06-03T12:00:00.000Z`,
  },
  actors: [
    {
      id: `actor_alice`,
      wikiSpaceId: `wiki_demo`,
      kind: `human`,
      displayName: `Alice`,
      avatarColor: `blue`,
      createdAt: `2026-06-03T12:00:00.000Z`,
    },
  ],
}

const joinedSnapshot: WikiSpaceSnapshot = {
  ...snapshot,
  space: { ...snapshot.space, memberCount: 2 },
  currentActor: {
    id: `actor_bob`,
    wikiSpaceId: `wiki_demo`,
    kind: `human`,
    displayName: `Bob`,
    avatarColor: `green`,
    createdAt: `2026-06-03T12:05:00.000Z`,
  },
  actors: [
    snapshot.actors[0],
    {
      id: `actor_bob`,
      wikiSpaceId: `wiki_demo`,
      kind: `human`,
      displayName: `Bob`,
      avatarColor: `green`,
      createdAt: `2026-06-03T12:05:00.000Z`,
    },
  ],
}

describe(`LocalDemoWikiStateProducer`, () => {
  beforeEach(() => {
    resetLocalDemoWikiStateProducerForTests()
  })

  it(`bootstraps space, actor, membership, and creation activity rows`, () => {
    const producer = getWikiStateProducer()
    const rows = producer.bootstrapSpace(snapshot)

    expect(rows.wiki_spaces).toHaveLength(1)
    expect(rows.wiki_spaces[0]).toMatchObject({
      id: `wiki_demo`,
      title: `Demo Space`,
      status: `active`,
    })
    expect(rows.actors).toHaveLength(1)
    expect(rows.memberships).toEqual([
      expect.objectContaining({ actor_id: `actor_alice`, role: `owner` }),
    ])
    expect(rows.activity_events).toEqual([
      expect.objectContaining({
        id: `event_space-created-wiki_demo`,
        event_type: `space_created`,
        subject_id: `wiki_demo`,
      }),
    ])
  })

  it(`records a join idempotently by actor`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)
    producer.recordJoin(joinedSnapshot)
    const rows = producer.recordJoin(joinedSnapshot)

    expect(rows.actors.map((actor) => actor.id).sort()).toEqual([
      `actor_alice`,
      `actor_bob`,
    ])
    expect(rows.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_id: `actor_alice`, role: `owner` }),
        expect.objectContaining({ actor_id: `actor_bob`, role: `member` }),
      ])
    )
    expect(
      rows.activity_events.filter(
        (event) => event.event_type === `space_joined`
      )
    ).toHaveLength(1)
  })

  it(`stores source submissions and activity events without graph or review rows`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)

    const result = producer.submitSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      kind: `url`,
      title: `Electric Agents`,
      url: `https://electric-sql.com/docs/agents`,
    })

    expect(result.source).toMatchObject({
      wiki_space_id: `wiki_demo`,
      status: `submitted`,
      kind: `url`,
    })
    expect(result.activityEvent).toMatchObject({
      event_type: `source_submitted`,
      subject_id: result.source.id,
    })
    expect(result.rows.sources).toHaveLength(1)
    expect(result.rows.wiki_pages).toEqual([])
    expect(result.rows.wiki_links).toEqual([])
    expect(result.rows.review_items).toEqual([])
  })
})
