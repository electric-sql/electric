import { describe, expect, it } from 'vitest'

import {
  LIVING_WIKI_ROLE_IDS,
  LIVING_WIKI_ROLES,
  PHASE_CONSTRAINTS,
} from './index'

const expectedIds = [`curator`, `synthesizer`, `reviewer`, `source-ingester`]

describe(`Living Wiki role manuals`, () => {
  it(`exports stable role ids and aggregate roles`, () => {
    expect([...LIVING_WIKI_ROLE_IDS]).toEqual(expectedIds)
    expect(LIVING_WIKI_ROLES.map((role) => role.id)).toEqual(expectedIds)
    expect(LIVING_WIKI_ROLES.map((role) => role.name)).toEqual([
      `Curator`,
      `Synthesizer`,
      `Reviewer`,
      `Source Ingester`,
    ])
  })

  it(`keeps every manual constrained to the inert scaffold phase`, () => {
    for (const role of LIVING_WIKI_ROLES) {
      for (const constraint of PHASE_CONSTRAINTS) {
        expect(role.manual).toContain(constraint)
      }
      expect(role.manual).toMatch(/inert scaffold phase/i)
    }
  })
})
