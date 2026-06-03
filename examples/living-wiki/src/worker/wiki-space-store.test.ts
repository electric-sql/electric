import { beforeEach, describe, expect, it } from 'vitest'
import { wikiSpaceSnapshotSchema } from '../shared/space'
import type { WorkerEnv } from './env'
import {
  LocalDemoWikiSpaceStore,
  WikiSpaceActorNotFoundError,
  WikiSpaceNotFoundError,
  getWikiSpaceStore,
  resetLocalDemoWikiSpaceStoreForTests,
} from './wiki-space-store'

const env: WorkerEnv = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://example.invalid`,
  ELECTRIC_CLOUD_API_TOKEN: `super-secret-token`,
  ELECTRIC_AGENTS_SPACE_ID: `agents-space-secret`,
}

describe(`LocalDemoWikiSpaceStore`, () => {
  beforeEach(() => {
    resetLocalDemoWikiSpaceStoreForTests()
  })

  it(`creates a space and creator actor`, async () => {
    const store = new LocalDemoWikiSpaceStore()

    const snapshot = await store.createSpace({
      title: `  Demo Wiki  `,
      displayName: `  Ada  `,
      avatarColor: `purple`,
    })

    expect(snapshot.space.id).toMatch(/^wiki_/)
    expect(snapshot.space.title).toBe(`Demo Wiki`)
    expect(snapshot.space.memberCount).toBe(1)
    expect(snapshot.currentActor.id).toMatch(/^actor_/)
    expect(snapshot.space.createdByActorId).toBe(snapshot.currentActor.id)
    expect(snapshot.currentActor.displayName).toBe(`Ada`)
    expect(snapshot.currentActor.avatarColor).toBe(`purple`)
    expect(snapshot.actors).toEqual([snapshot.currentActor])
    expect(wikiSpaceSnapshotSchema.parse(snapshot)).toEqual(snapshot)
  })

  it(`joins an existing space with a new actor`, async () => {
    const store = new LocalDemoWikiSpaceStore()
    const created = await store.createSpace({
      title: `Demo Wiki`,
      displayName: `Ada`,
      avatarColor: `purple`,
    })

    const joined = await store.joinSpace({
      wikiSpaceId: created.space.id,
      displayName: `Grace`,
      avatarColor: `green`,
    })

    expect(joined.space.memberCount).toBe(2)
    expect(joined.currentActor.displayName).toBe(`Grace`)
    expect(joined.currentActor.id).not.toBe(created.currentActor.id)
    expect(joined.actors.map((actor) => actor.displayName)).toEqual([
      `Ada`,
      `Grace`,
    ])
  })

  it(`updates an existing actor on idempotent join without incrementing member count`, async () => {
    const store = new LocalDemoWikiSpaceStore()
    const created = await store.createSpace({
      title: `Demo Wiki`,
      displayName: `Ada`,
      avatarColor: `purple`,
    })

    const joined = await store.joinSpace({
      wikiSpaceId: created.space.id,
      actorId: created.currentActor.id,
      displayName: `Ada Updated`,
      avatarColor: `pink`,
    })

    expect(joined.space.memberCount).toBe(1)
    expect(joined.currentActor.id).toBe(created.currentActor.id)
    expect(joined.currentActor.displayName).toBe(`Ada Updated`)
    expect(joined.currentActor.avatarColor).toBe(`pink`)
    expect(joined.actors).toHaveLength(1)
  })

  it(`gets an existing space and selects requested actor when present`, async () => {
    const store = new LocalDemoWikiSpaceStore()
    const created = await store.createSpace({
      title: `Demo`,
      displayName: `Ada`,
      avatarColor: `blue`,
    })
    const joined = await store.joinSpace({
      wikiSpaceId: created.space.id,
      displayName: `Grace`,
      avatarColor: `orange`,
    })

    await expect(
      store.getSpace({ wikiSpaceId: created.space.id })
    ).resolves.toMatchObject({
      currentActor: { id: created.currentActor.id },
    })
    await expect(
      store.getSpace({
        wikiSpaceId: created.space.id,
        actorId: joined.currentActor.id,
      })
    ).resolves.toMatchObject({
      currentActor: { id: joined.currentActor.id },
    })
  })

  it(`throws a typed error when an explicit actor id is unknown`, async () => {
    const store = new LocalDemoWikiSpaceStore()
    const created = await store.createSpace({
      title: `Demo`,
      displayName: `Ada`,
      avatarColor: `blue`,
    })

    await expect(
      store.getSpace({
        wikiSpaceId: created.space.id,
        actorId: `actor_missing`,
      })
    ).rejects.toMatchObject({
      wikiSpaceId: created.space.id,
      actorId: `actor_missing`,
    })
    await expect(
      store.getSpace({
        wikiSpaceId: created.space.id,
        actorId: `actor_missing`,
      })
    ).rejects.toBeInstanceOf(WikiSpaceActorNotFoundError)
  })

  it(`throws a typed error for unknown spaces`, async () => {
    const store = new LocalDemoWikiSpaceStore()

    await expect(
      store.getSpace({ wikiSpaceId: `wiki_missing` })
    ).rejects.toMatchObject({
      wikiSpaceId: `wiki_missing`,
    })
    await expect(
      store.joinSpace({
        wikiSpaceId: `wiki_missing`,
        displayName: `Ada`,
        avatarColor: `slate`,
      })
    ).rejects.toBeInstanceOf(WikiSpaceNotFoundError)
  })

  it(`does not include worker secret fields in serialized snapshots`, async () => {
    const store = getWikiSpaceStore(env)
    const snapshot = await store.createSpace({
      title: `Demo`,
      displayName: `Ada`,
      avatarColor: `slate`,
    })

    const serialized = JSON.stringify(snapshot)

    expect(serialized).not.toContain(`super-secret-token`)
    expect(serialized).not.toContain(`agents-space-secret`)
    expect(serialized).not.toContain(`ELECTRIC_CLOUD_API_TOKEN`)
    expect(serialized).not.toContain(`ELECTRIC_AGENTS_SPACE_ID`)
    expect(wikiSpaceSnapshotSchema.parse(JSON.parse(serialized))).toEqual(
      snapshot
    )
  })
})
