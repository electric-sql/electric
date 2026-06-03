import { beforeEach, describe, expect, it } from 'vitest'
import worker from './index'
import { resetLocalDemoWikiSpaceStoreForTests } from './wiki-space-store'

const env = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://api.example.test`,
  ELECTRIC_CLOUD_API_TOKEN: `test-token`,
  ELECTRIC_AGENTS_SPACE_ID: `space_test`,
  ENABLE_SEEDED_DEMO: `true`,
} satisfies Record<string, string>

const trpcRequest = async (
  procedure: string,
  input: unknown,
  method: `GET` | `POST`
) => {
  const url = new URL(`https://living-wiki.test/trpc/${procedure}`)
  const init: RequestInit = { method }

  if (method === `GET`) {
    url.searchParams.set(`input`, JSON.stringify(input))
  } else {
    init.headers = { 'content-type': `application/json` }
    init.body = JSON.stringify(input)
  }

  return worker.fetch(new Request(url, init), env, {} as ExecutionContext)
}

const readTrpcData = async <T>(response: Response): Promise<T> => {
  const body = (await response.json()) as { result: { data: T } }
  return body.result.data
}

describe(`living wiki worker`, () => {
  beforeEach(() => {
    resetLocalDemoWikiSpaceStoreForTests()
  })

  it(`returns REST health JSON`, async () => {
    const request = new Request(`https://living-wiki.test/api/health`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      app: `living-wiki`,
      env: `test`,
      electricCloudConfigured: true,
      seededDemoEnabled: true,
    })
  })

  it(`returns 404 JSON for unknown API routes`, async () => {
    const request = new Request(`https://living-wiki.test/api/missing`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `Not found`,
    })
  })

  it(`returns tRPC health JSON`, async () => {
    const request = new Request(`https://living-wiki.test/trpc/health`, {
      method: `GET`,
    })
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { data: unknown } }
    expect(body.result.data).toMatchObject({
      ok: true,
      app: `living-wiki`,
      env: `test`,
    })
  })

  it(`does not route non-tRPC prefix matches to tRPC`, async () => {
    const request = new Request(`https://living-wiki.test/trpcfoo`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe(`Living Wiki API`)
  })

  it(`creates spaces over tRPC`, async () => {
    const response = await trpcRequest(
      `space.create`,
      { title: `Demo`, displayName: `Alice`, avatarColor: `blue` },
      `POST`
    )

    expect(response.status).toBe(200)
    const snapshot = await readTrpcData<{
      space: { id: string; memberCount: number; createdByActorId: string }
      currentActor: { id: string; wikiSpaceId: string; displayName: string }
      actors: unknown[]
    }>(response)
    expect(snapshot.space.id).toMatch(/^wiki_/)
    expect(snapshot.space.memberCount).toBe(1)
    expect(snapshot.currentActor.id).toBe(snapshot.space.createdByActorId)
    expect(snapshot.currentActor.wikiSpaceId).toBe(snapshot.space.id)
    expect(snapshot.actors).toHaveLength(1)
  })

  it(`joins spaces over tRPC`, async () => {
    const created = await readTrpcData<{ space: { id: string } }>(
      await trpcRequest(
        `space.create`,
        { title: `Demo`, displayName: `Alice`, avatarColor: `blue` },
        `POST`
      )
    )

    const response = await trpcRequest(
      `space.join`,
      {
        wikiSpaceId: created.space.id,
        displayName: `Bob`,
        avatarColor: `green`,
      },
      `POST`
    )

    expect(response.status).toBe(200)
    const snapshot = await readTrpcData<{
      space: { id: string; memberCount: number }
      currentActor: { displayName: string }
    }>(response)
    expect(snapshot.space.id).toBe(created.space.id)
    expect(snapshot.space.memberCount).toBe(2)
    expect(snapshot.currentActor.displayName).toBe(`Bob`)
  })

  it(`gets spaces over tRPC using the provided current actor`, async () => {
    const created = await readTrpcData<{
      space: { id: string }
      currentActor: { id: string }
    }>(
      await trpcRequest(
        `space.create`,
        { title: `Demo`, displayName: `Alice`, avatarColor: `blue` },
        `POST`
      )
    )

    const response = await trpcRequest(
      `space.get`,
      { wikiSpaceId: created.space.id, actorId: created.currentActor.id },
      `GET`
    )

    expect(response.status).toBe(200)
    const snapshot = await readTrpcData<{ currentActor: { id: string } }>(
      response
    )
    expect(snapshot.currentActor.id).toBe(created.currentActor.id)
  })

  it(`returns a tRPC not found error for unknown current actors`, async () => {
    const created = await readTrpcData<{ space: { id: string } }>(
      await trpcRequest(
        `space.create`,
        { title: `Demo`, displayName: `Alice`, avatarColor: `blue` },
        `POST`
      )
    )

    const response = await trpcRequest(
      `space.get`,
      { wikiSpaceId: created.space.id, actorId: `actor_missing` },
      `GET`
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      error: { message: string; data: { code: string } }
    }
    expect(body.error.message).toContain(
      `Actor not found in WikiSpace ${created.space.id}: actor_missing`
    )
    expect(body.error.data.code).toBe(`NOT_FOUND`)
  })

  it(`returns a tRPC not found error for unknown spaces`, async () => {
    const response = await trpcRequest(
      `space.get`,
      { wikiSpaceId: `wiki_missing` },
      `GET`
    )

    expect(response.status).toBe(404)
    const body = (await response.json()) as {
      error: { message: string; data: { code: string } }
    }
    expect(body.error.message).toContain(`WikiSpace not found: wiki_missing`)
    expect(body.error.data.code).toBe(`NOT_FOUND`)
  })

  it(`does not include configured token strings in tRPC space JSON`, async () => {
    const response = await trpcRequest(
      `space.create`,
      { title: `Demo`, displayName: `Alice`, avatarColor: `blue` },
      `POST`
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.not.toContain(
      env.ELECTRIC_CLOUD_API_TOKEN
    )
  })
})
