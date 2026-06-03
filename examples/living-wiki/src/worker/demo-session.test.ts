import { describe, expect, it } from 'vitest'
import {
  createDemoId,
  isDemoAvatarColor,
  normalizeDisplayName,
  normalizeSpaceTitle,
} from './demo-session'

const urlSafeLowercaseId = /^(wiki|actor)_[a-z0-9_-]+$/

describe(`worker demo session helpers`, () => {
  it(`trims display names`, () => {
    expect(normalizeDisplayName(`  Ada Lovelace  `)).toBe(`Ada Lovelace`)
  })

  it(`trims space titles`, () => {
    expect(normalizeSpaceTitle(`  Analytical Engine Notes  `)).toBe(
      `Analytical Engine Notes`
    )
  })

  it(`validates demo avatar palette values`, () => {
    expect(isDemoAvatarColor(`slate`)).toBe(true)
    expect(isDemoAvatarColor(`purple`)).toBe(true)
    expect(isDemoAvatarColor(`red`)).toBe(false)
    expect(isDemoAvatarColor(`Purple`)).toBe(false)
  })

  it(`generates ids with the requested prefix`, () => {
    expect(createDemoId(`wiki`)).toMatch(/^wiki_/)
    expect(createDemoId(`actor`)).toMatch(/^actor_/)
  })

  it(`creates URL-safe lowercase ids from source values`, () => {
    expect(createDemoId(`wiki`, `My Source! With Spaces`)).toMatch(
      urlSafeLowercaseId
    )
    expect(createDemoId(`wiki`, `My Source! With Spaces`)).toBe(
      `wiki_my_source_with_spaces`
    )
  })

  it(`creates deterministic seeded ids`, () => {
    expect(createDemoId(`actor`, `Ada Lovelace`)).toBe(`actor_ada_lovelace`)
    expect(createDemoId(`actor`, `Ada Lovelace`)).toBe(
      createDemoId(`actor`, `Ada Lovelace`)
    )
  })

  it(`falls back to a deterministic non-empty suffix for blank sources`, () => {
    expect(createDemoId(`wiki`, `   `)).toBe(`wiki_demo`)
  })
})
