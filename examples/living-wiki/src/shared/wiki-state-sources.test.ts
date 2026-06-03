import { describe, expect, it } from 'vitest'

import { activityEventSchema, sourceSchema } from './wiki-state'
import {
  SOURCE_TEXT_BODY_MAX_LENGTH,
  SOURCE_TEXT_PREVIEW_MAX_LENGTH,
  buildSourceSubmissionRows,
  submitSourceCommandSchema,
} from './wiki-state-sources'

const fixedNow = () => new Date(`2026-06-03T12:00:00.000Z`)

const base = {
  wikiSpaceId: `wiki_demo`,
  actorId: `actor_owner`,
  title: `Intro`,
} as const

describe(`living wiki source row builders`, () => {
  it(`builds a submitted text source and ambient activity event`, () => {
    const rows = buildSourceSubmissionRows(
      { ...base, kind: `text`, body: `Some bounded source text.` },
      { now: fixedNow, sourceSeed: `intro`, eventSeed: `source-intro` }
    )

    expect(sourceSchema.safeParse(rows.source).success).toBe(true)
    expect(activityEventSchema.safeParse(rows.activityEvent).success).toBe(true)
    expect(rows.source).toMatchObject({
      id: `source_intro`,
      wiki_space_id: `wiki_demo`,
      kind: `text`,
      status: `submitted`,
      title: `Intro`,
      url: null,
      text_preview: `Some bounded source text.`,
      submitted_by_actor_id: `actor_owner`,
      submitted_at: `2026-06-03T12:00:00.000Z`,
      published_at: null,
      metadata: { body_length: 25 },
    })
    expect(rows.activityEvent).toMatchObject({
      id: `event_source-intro`,
      event_type: `source_submitted`,
      subject_type: `source`,
      subject_id: `source_intro`,
      summary: `Intro submitted as a text source`,
      visibility: `ambient`,
    })
  })

  it(`builds a submitted URL source without fetching content`, () => {
    const rows = buildSourceSubmissionRows(
      { ...base, kind: `url`, url: `https://example.com/docs?a=1` },
      { now: fixedNow, sourceSeed: `docs`, eventSeed: `source-docs` }
    )

    expect(rows.source).toMatchObject({
      id: `source_docs`,
      kind: `url`,
      status: `submitted`,
      url: `https://example.com/docs?a=1`,
      text_preview: null,
      published_at: null,
      metadata: { url_host: `example.com` },
    })
    expect(sourceSchema.safeParse(rows.source).success).toBe(true)
  })

  it(`rejects invalid URLs`, () => {
    expect(
      submitSourceCommandSchema.safeParse({
        ...base,
        kind: `url`,
        url: `not-a-url`,
      }).success
    ).toBe(false)
    expect(() =>
      buildSourceSubmissionRows({ ...base, kind: `url`, url: `not-a-url` })
    ).toThrow()
  })

  it(`truncates text preview and rejects unbounded text body`, () => {
    const body = `x`.repeat(SOURCE_TEXT_PREVIEW_MAX_LENGTH + 10)
    const rows = buildSourceSubmissionRows({ ...base, kind: `text`, body })

    expect(rows.source.text_preview).toHaveLength(
      SOURCE_TEXT_PREVIEW_MAX_LENGTH
    )

    expect(() =>
      buildSourceSubmissionRows({
        ...base,
        kind: `text`,
        body: `x`.repeat(SOURCE_TEXT_BODY_MAX_LENGTH + 1),
      })
    ).toThrow()
  })

  it(`rejects invalid wiki space and actor ids`, () => {
    expect(() =>
      buildSourceSubmissionRows({
        ...base,
        wikiSpaceId: `space_bad`,
        kind: `text`,
        body: `body`,
      })
    ).toThrow()
    expect(() =>
      buildSourceSubmissionRows({
        ...base,
        actorId: `user_bad`,
        kind: `text`,
        body: `body`,
      })
    ).toThrow()
  })
})
