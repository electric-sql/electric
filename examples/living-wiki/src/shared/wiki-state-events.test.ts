import { describe, expect, it } from 'vitest'

import {
  buildActivityEventInsertEvent,
  buildActivityEventRow,
  createActivityEventInputSchema,
} from './wiki-state-events'

const input = {
  wiki_space_id: `wiki_demo`,
  actor_id: `actor_owner`,
  actor_kind: `human`,
  event_type: `source_submitted`,
  summary: `Submitted a source`,
  subject_type: `source`,
  subject_id: `source_intro`,
} as const

const fixedNow = () => new Date(`2026-06-03T12:00:00.000Z`)

describe(`living wiki state event builders`, () => {
  it(`validates activity event builder inputs`, () => {
    expect(createActivityEventInputSchema.safeParse(input).success).toBe(true)
    expect(
      createActivityEventInputSchema.safeParse({
        ...input,
        upstream_entity_url: `https://agents.example.test/entities/1`,
      }).success
    ).toBe(false)
    expect(
      createActivityEventInputSchema.safeParse({
        ...input,
        token: `secret`,
      }).success
    ).toBe(false)
    expect(
      createActivityEventInputSchema.safeParse({
        ...input,
        event_type: ``,
      }).success
    ).toBe(false)
  })

  it(`builds validated activity event rows with defaults`, () => {
    const row = buildActivityEventRow(input, { now: fixedNow })

    expect(row).toEqual({
      ...input,
      id: expect.stringMatching(/^event_[a-z0-9_-]+$/),
      occurred_at: `2026-06-03T12:00:00.000Z`,
      visibility: `ambient`,
      metadata: {},
    })
  })

  it(`supports deterministic id and timestamp injection`, () => {
    expect(
      buildActivityEventRow(input, {
        id: `event_source-submitted-1`,
        now: fixedNow,
      })
    ).toMatchObject({
      id: `event_source-submitted-1`,
      occurred_at: `2026-06-03T12:00:00.000Z`,
    })
  })

  it(`rejects invalid generated rows`, () => {
    expect(() =>
      buildActivityEventRow({ ...input, subject_id: `` }, { now: fixedNow })
    ).toThrow()
    expect(() =>
      buildActivityEventRow(input, { id: `activity_bad`, now: fixedNow })
    ).toThrow()
  })

  it(`builds durable insert change events with the exact collection event type`, () => {
    const event = buildActivityEventInsertEvent(input, {
      id: `event_source-submitted-1`,
      now: fixedNow,
    })

    expect(event).toEqual({
      type: `activity_event`,
      key: `event_source-submitted-1`,
      value: buildActivityEventRow(input, {
        id: `event_source-submitted-1`,
        now: fixedNow,
      }),
      headers: { operation: `insert` },
    })
  })
})
