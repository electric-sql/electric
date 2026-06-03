import { describe, expect, it } from 'vitest'

import {
  actorSchema,
  activityEventSchema,
  agentRunSchema,
  livingWikiStateCollections,
  membershipSchema,
  reviewItemSchema,
  sourceSchema,
  wikiLinkSchema,
  wikiPageSchema,
  wikiSpaceSchema,
} from './wiki-state'

const now = `2026-06-03T12:00:00.000Z`

const rows = {
  wiki_spaces: {
    id: `wiki_demo`,
    title: `Demo Wiki`,
    created_at: now,
    created_by_actor_id: `actor_owner`,
    status: `active`,
  },
  actors: {
    id: `actor_owner`,
    wiki_space_id: `wiki_demo`,
    kind: `human`,
    display_name: `Owner`,
    avatar_color: `blue`,
    created_at: now,
  },
  memberships: {
    id: `membership_owner`,
    wiki_space_id: `wiki_demo`,
    actor_id: `actor_owner`,
    role: `owner`,
    joined_at: now,
    status: `active`,
  },
  activity_events: {
    id: `event_created`,
    wiki_space_id: `wiki_demo`,
    occurred_at: now,
    actor_id: `actor_owner`,
    actor_kind: `human`,
    event_type: `space_created`,
    summary: `Created the wiki`,
    subject_type: `wiki_space`,
    subject_id: `wiki_demo`,
    visibility: `ambient`,
    metadata: {},
  },
  sources: {
    id: `source_intro`,
    wiki_space_id: `wiki_demo`,
    kind: `text`,
    status: `submitted`,
    title: `Intro notes`,
    url: null,
    text_preview: `Some useful notes`,
    submitted_by_actor_id: `actor_owner`,
    submitted_at: now,
    published_at: null,
    metadata: {},
  },
  wiki_pages: {
    id: `page_intro`,
    wiki_space_id: `wiki_demo`,
    slug: `intro`,
    title: `Intro`,
    status: `proposed`,
    summary: `A short intro`,
    body: null,
    source_ids: [],
    created_at: now,
    updated_at: now,
    created_by_run_id: null,
  },
  wiki_links: {
    id: `link_intro_next`,
    wiki_space_id: `wiki_demo`,
    from_page_id: `page_intro`,
    to_page_id: `page_next`,
    status: `proposed`,
    label: null,
    rationale: null,
    source_ids: [],
    created_at: now,
    created_by_run_id: null,
  },
  review_items: {
    id: `review_intro`,
    wiki_space_id: `wiki_demo`,
    kind: `page`,
    status: `open`,
    target_type: `wiki_page`,
    target_id: `page_intro`,
    suggested_change: `Review the proposed page`,
    rationale: null,
    created_at: now,
    created_by_run_id: null,
    resolved_at: null,
    resolved_by_actor_id: null,
    resolution_note: null,
  },
  agent_runs: {
    id: `agent_run_intro`,
    wiki_space_id: `wiki_demo`,
    agent_kind: `page_writer`,
    status: `queued`,
    input_ref_type: `source`,
    input_ref_id: `source_intro`,
    started_at: now,
    finished_at: null,
    error_message: null,
  },
} as const

const schemas = {
  wiki_spaces: wikiSpaceSchema,
  actors: actorSchema,
  memberships: membershipSchema,
  activity_events: activityEventSchema,
  sources: sourceSchema,
  wiki_pages: wikiPageSchema,
  wiki_links: wikiLinkSchema,
  review_items: reviewItemSchema,
  agent_runs: agentRunSchema,
} as const

describe(`living wiki shared-state schemas`, () => {
  it(`accepts valid minimal rows for every collection`, () => {
    for (const [name, schema] of Object.entries(schemas)) {
      expect(
        schema.safeParse(rows[name as keyof typeof rows]).success,
        name
      ).toBe(true)
    }
  })

  it(`rejects invalid id prefixes`, () => {
    expect(
      wikiSpaceSchema.safeParse({ ...rows.wiki_spaces, id: `space_demo` })
        .success
    ).toBe(false)
    expect(
      actorSchema.safeParse({ ...rows.actors, id: `user_owner` }).success
    ).toBe(false)
    expect(
      sourceSchema.safeParse({ ...rows.sources, id: `src_intro` }).success
    ).toBe(false)
  })

  it(`rejects invalid timestamps`, () => {
    expect(
      wikiSpaceSchema.safeParse({
        ...rows.wiki_spaces,
        created_at: `2026-06-03`,
      }).success
    ).toBe(false)
  })

  it(`rejects unknown enum values`, () => {
    expect(actorSchema.safeParse({ ...rows.actors, kind: `bot` }).success).toBe(
      false
    )
    expect(
      membershipSchema.safeParse({ ...rows.memberships, role: `admin` }).success
    ).toBe(false)
  })

  it(`rejects missing primary keys`, () => {
    const { id: _id, ...withoutId } = rows.wiki_pages
    expect(wikiPageSchema.safeParse(withoutId).success).toBe(false)
  })

  it(`rejects overlong strings`, () => {
    expect(
      wikiSpaceSchema.safeParse({ ...rows.wiki_spaces, title: `x`.repeat(121) })
        .success
    ).toBe(false)
    expect(
      activityEventSchema.safeParse({
        ...rows.activity_events,
        summary: `x`.repeat(281),
      }).success
    ).toBe(false)
  })

  it(`enforces source conditional rules`, () => {
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        kind: `url`,
        url: `https://example.com`,
        text_preview: null,
      }).success
    ).toBe(true)
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        kind: `url`,
        url: `not a url`,
        text_preview: null,
      }).success
    ).toBe(false)
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        kind: `text`,
        url: null,
        text_preview: `preview`,
      }).success
    ).toBe(true)
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        kind: `text`,
        url: null,
        text_preview: null,
      }).success
    ).toBe(false)
  })

  it(`enforces practical nullable conditional state rules`, () => {
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        status: `published`,
        published_at: now,
      }).success
    ).toBe(true)
    expect(
      sourceSchema.safeParse({
        ...rows.sources,
        status: `published`,
        published_at: null,
      }).success
    ).toBe(false)
    expect(
      agentRunSchema.safeParse({
        ...rows.agent_runs,
        status: `succeeded`,
        finished_at: now,
      }).success
    ).toBe(true)
    expect(
      agentRunSchema.safeParse({
        ...rows.agent_runs,
        status: `succeeded`,
        finished_at: null,
      }).success
    ).toBe(false)
    expect(
      agentRunSchema.safeParse({
        ...rows.agent_runs,
        status: `failed`,
        finished_at: now,
        error_message: `Boom`,
      }).success
    ).toBe(true)
    expect(
      agentRunSchema.safeParse({
        ...rows.agent_runs,
        status: `failed`,
        finished_at: now,
        error_message: null,
      }).success
    ).toBe(false)
    expect(
      reviewItemSchema.safeParse({
        ...rows.review_items,
        status: `approved`,
        resolved_at: now,
        resolved_by_actor_id: `actor_owner`,
      }).success
    ).toBe(true)
    expect(
      reviewItemSchema.safeParse({
        ...rows.review_items,
        status: `approved`,
        resolved_at: null,
        resolved_by_actor_id: null,
      }).success
    ).toBe(false)
  })

  it(`defines unique collection event types with id primary keys`, () => {
    const definitions = Object.values(livingWikiStateCollections)
    expect(new Set(definitions.map((definition) => definition.type)).size).toBe(
      definitions.length
    )
    expect(
      definitions.every((definition) => definition.primaryKey === `id`)
    ).toBe(true)
  })
})
