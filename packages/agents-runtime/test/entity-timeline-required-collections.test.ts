import { describe, expect, it } from 'vitest'
import { buildEntityTimelineData } from '../src/entity-timeline'
import { buildStreamFixture } from './helpers/context-test-helpers'

describe(`entity timeline required collections`, () => {
  it(`throws when a required collection is missing`, () => {
    const db = buildStreamFixture([])
    delete (db.collections as Record<string, unknown>).contextRemoved

    expect(() => buildEntityTimelineData(db)).toThrow(
      `[agent-runtime] entity timeline requires collection "contextRemoved" but it was not registered`
    )
  })
})
