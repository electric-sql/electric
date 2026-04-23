import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRegistry,
  defineEntity,
  getEntityType,
  listEntityTypes,
} from '../src/define-entity'

beforeEach(() => {
  clearRegistry()
})

describe(`defineEntity`, () => {
  it(`registers an entity type with name and handler`, () => {
    defineEntity(`pr-reviewer`, {
      handler: async () => {},
    })

    const entry = getEntityType(`pr-reviewer`)
    expect(entry).toBeDefined()
    expect(entry!.name).toBe(`pr-reviewer`)
    expect(entry!.definition.handler).toBeTypeOf(`function`)
  })

  it(`throws on duplicate entity type name`, () => {
    defineEntity(`chat-agent`, { handler: async () => {} })

    expect(() =>
      defineEntity(`chat-agent`, { handler: async () => {} })
    ).toThrow(/already registered/)
  })

  it(`lists all registered entity types`, () => {
    defineEntity(`type-a`, { handler: async () => {} })
    defineEntity(`type-b`, { handler: async () => {} })

    const types = listEntityTypes()
    expect(types.map((type) => type.name)).toEqual([`type-a`, `type-b`])
  })

  it(`returns undefined for unregistered type`, () => {
    expect(getEntityType(`nonexistent`)).toBeUndefined()
  })
})
