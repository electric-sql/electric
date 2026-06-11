import { describe, expect, it } from 'vitest'
import { UI_ENTITY_CUSTOM_STATE } from './entity-connection'

describe(`UI_ENTITY_CUSTOM_STATE`, () => {
  it(`exposes a comments collection so db.collections.comments is defined`, () => {
    expect(UI_ENTITY_CUSTOM_STATE.comments).toBeDefined()
  })

  it(`comments collection has the correct type`, () => {
    expect(UI_ENTITY_CUSTOM_STATE.comments.type).toBe(`state:comments`)
  })

  it(`comments collection is externally writable`, () => {
    expect(UI_ENTITY_CUSTOM_STATE.comments.externallyWritable).toBe(true)
  })
})
