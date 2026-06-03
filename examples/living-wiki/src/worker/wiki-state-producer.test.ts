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
  it(`proposes pages idempotently and returns page/review rows`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)
    const { source } = producer.submitSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      kind: `text`,
      title: `Proposal`,
      body: `Draft body`,
    })

    const first = producer.proposePageFromSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      sourceId: source.id,
    })
    const second = producer.proposePageFromSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      sourceId: source.id,
    })

    expect(second.page.id).toBe(first.page.id)
    expect(second.reviewItem.id).toBe(first.reviewItem.id)
    expect(second.rows.wiki_pages).toHaveLength(1)
    expect(second.rows.review_items).toHaveLength(1)
    expect(
      second.rows.activity_events.filter(
        (event) => event.event_type === `page_proposed`
      )
    ).toHaveLength(1)
  })

  it(`throws for missing proposal sources`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)

    expect(() =>
      producer.proposePageFromSource({
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_alice`,
        sourceId: `source_missing`,
      })
    ).toThrow(/Source not found/)
  })

  it(`approves and rejects page reviews with page status updates`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)
    const approvedSource = producer.submitSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      kind: `text`,
      title: `Approve Me`,
      body: `A`,
    }).source
    const approvedProposal = producer.proposePageFromSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      sourceId: approvedSource.id,
    })

    const approved = producer.resolveReviewItem({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      reviewItemId: approvedProposal.reviewItem.id,
      resolution: `approve`,
      note: `Looks good`,
    })
    expect(approved.reviewItem.status).toBe(`approved`)
    expect(approved.reviewItem.resolution_note).toBe(`Looks good`)
    expect(approved.page.status).toBe(`canonical`)
    expect(approved.activityEvent.event_type).toBe(`review_approved`)

    const rejectedSource = producer.submitSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      kind: `text`,
      title: `Reject Me`,
      body: `R`,
    }).source
    const rejectedProposal = producer.proposePageFromSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      sourceId: rejectedSource.id,
    })
    const rejected = producer.resolveReviewItem({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      reviewItemId: rejectedProposal.reviewItem.id,
      resolution: `reject`,
    })
    expect(rejected.reviewItem.status).toBe(`rejected`)
    expect(rejected.page.status).toBe(`rejected`)
    expect(rejected.activityEvent.event_type).toBe(`review_rejected`)
  })

  it(`rejects already resolved reviews`, () => {
    const producer = getWikiStateProducer()
    producer.bootstrapSpace(snapshot)
    const source = producer.submitSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      kind: `text`,
      title: `Once`,
      body: `Only once`,
    }).source
    const proposal = producer.proposePageFromSource({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      sourceId: source.id,
    })
    producer.resolveReviewItem({
      wikiSpaceId: `wiki_demo`,
      actorId: `actor_alice`,
      reviewItemId: proposal.reviewItem.id,
      resolution: `approve`,
    })

    expect(() =>
      producer.resolveReviewItem({
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_alice`,
        reviewItemId: proposal.reviewItem.id,
        resolution: `reject`,
      })
    ).toThrow(/already resolved/)
  })
})
