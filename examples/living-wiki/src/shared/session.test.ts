import { describe, expect, it } from 'vitest'
import {
  clearDemoSessionIdentity,
  readDemoSessionIdentity,
  writeDemoSessionIdentity,
} from './session'
import { createSpaceInputSchema, joinSpaceInputSchema } from './space'

class MemoryStorage
  implements Pick<Storage, `getItem` | `setItem` | `removeItem`>
{
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe(`demo session identity`, () => {
  it(`returns an empty identity for empty storage`, () => {
    expect(readDemoSessionIdentity(new MemoryStorage())).toEqual({})
  })

  it(`round-trips a valid identity`, () => {
    const storage = new MemoryStorage()

    writeDemoSessionIdentity(storage, {
      actorId: `actor_abc123`,
      displayName: `Ada Lovelace`,
      avatarColor: `purple`,
    })

    expect(readDemoSessionIdentity(storage)).toEqual({
      actorId: `actor_abc123`,
      displayName: `Ada Lovelace`,
      avatarColor: `purple`,
    })
  })

  it(`round-trips a partial identity`, () => {
    const storage = new MemoryStorage()

    writeDemoSessionIdentity(storage, { displayName: `Grace Hopper` })

    expect(readDemoSessionIdentity(storage)).toEqual({
      displayName: `Grace Hopper`,
    })
  })

  it(`returns an empty identity for malformed JSON`, () => {
    const storage = new MemoryStorage()
    storage.setItem(`living-wiki.demo-session.v1`, `{not json`)

    expect(readDemoSessionIdentity(storage)).toEqual({})
  })

  it(`ignores stored identities with invalid actor ids`, () => {
    const storage = new MemoryStorage()
    storage.setItem(
      `living-wiki.demo-session.v1`,
      JSON.stringify({ actorId: `undefined`, avatarColor: `blue` })
    )

    expect(readDemoSessionIdentity(storage)).toEqual({})
  })

  it(`clears the stored identity`, () => {
    const storage = new MemoryStorage()
    writeDemoSessionIdentity(storage, { actorId: `actor_abc123` })

    clearDemoSessionIdentity(storage)

    expect(readDemoSessionIdentity(storage)).toEqual({})
  })
})

describe(`space schemas`, () => {
  it(`trims strings before length validation`, () => {
    expect(
      createSpaceInputSchema.parse({
        title: `  Demo Wiki  `,
        displayName: `  Ada  `,
        avatarColor: `blue`,
      })
    ).toEqual({ title: `Demo Wiki`, displayName: `Ada`, avatarColor: `blue` })
  })

  it(`validates join input ids and avatar color`, () => {
    expect(
      joinSpaceInputSchema.parse({
        wikiSpaceId: `wiki_demo123`,
        displayName: `Ada`,
        avatarColor: `green`,
        actorId: `actor_abc123`,
      })
    ).toEqual({
      wikiSpaceId: `wiki_demo123`,
      displayName: `Ada`,
      avatarColor: `green`,
      actorId: `actor_abc123`,
    })
  })
})
