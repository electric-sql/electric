import { beforeEach, describe, expect, it } from 'vitest'
import worker from './index'
import { resetLocalDemoWikiSpaceStoreForTests } from './wiki-space-store'
import { resetLocalDemoWikiStateProducerForTests } from './wiki-state-producer'

const env = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://api.example.test`,
  ELECTRIC_CLOUD_API_TOKEN: `test-token`,
  ELECTRIC_AGENTS_SPACE_ID: `space_test`,
  ELECTRIC_AGENTS_BASE_URL: `https://agents-secret.example.test/runtime`,
  ELECTRIC_AGENTS_TOKEN: `agents-test-secret-token`,
  ELECTRIC_AGENTS_PRINCIPAL_KEY: `agents-principal-secret-key`,
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
    resetLocalDemoWikiStateProducerForTests()
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

  it(`does not leak Agents runtime env values through REST health JSON`, async () => {
    const request = new Request(`https://living-wiki.test/api/health`)
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).not.toContain(env.ELECTRIC_AGENTS_BASE_URL)
    expect(text).not.toContain(env.ELECTRIC_AGENTS_TOKEN)
    expect(text).not.toContain(env.ELECTRIC_AGENTS_PRINCIPAL_KEY)
  })

  it(`rejects REST seeded demo when disabled`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/demo/seed`, { method: `POST` }),
      { ...env, ENABLE_SEEDED_DEMO: `false` },
      {} as ExecutionContext
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `Seeded demo is disabled`,
    })
  })

  it(`seeds the REST demo idempotently with a submitted source`, async () => {
    const request = () =>
      new Request(`https://living-wiki.test/api/demo/seed`, { method: `POST` })

    const first = await worker.fetch(request(), env, {} as ExecutionContext)
    const second = await worker.fetch(request(), env, {} as ExecutionContext)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstBody = (await first.json()) as {
      space: { space: { id: string }; currentActor: { id: string } }
      sourceId: string
    }
    const secondBody = await second.json()
    expect(secondBody).toEqual(firstBody)

    const snapshot = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${firstBody.space.space.id}/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )
    const rows = (await snapshot.json()) as {
      sources: unknown[]
      activity_events: unknown[]
    }
    expect(rows.sources).toHaveLength(1)
    expect(rows.sources).toEqual([
      expect.objectContaining({
        id: firstBody.sourceId,
        status: `submitted`,
        kind: `text`,
      }),
    ])
    expect(rows.activity_events).toHaveLength(2)
  })

  it(`rejects REST seeded demo reset when disabled`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/demo/reset`, {
        method: `POST`,
      }),
      { ...env, ENABLE_SEEDED_DEMO: `false` },
      {} as ExecutionContext
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `Seeded demo is disabled`,
    })
  })

  it(`resets Worker-local seeded demo space and state`, async () => {
    const seededResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/demo/seed`, { method: `POST` }),
      env,
      {} as ExecutionContext
    )
    const seeded = (await seededResponse.json()) as {
      space: { space: { id: string }; currentActor: { id: string } }
    }

    const resetResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/demo/reset`, {
        method: `POST`,
      }),
      env,
      {} as ExecutionContext
    )
    expect(resetResponse.status).toBe(200)
    await expect(resetResponse.json()).resolves.toEqual({ ok: true })

    const getResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${seeded.space.space.id}`
      ),
      env,
      {} as ExecutionContext
    )
    expect(getResponse.status).toBe(404)
  })

  it(`runs seeded happy path from source to approved canonical page`, async () => {
    const seededResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/demo/seed`, { method: `POST` }),
      env,
      {} as ExecutionContext
    )
    const seeded = (await seededResponse.json()) as {
      space: { space: { id: string }; currentActor: { id: string } }
      sourceId: string
    }
    const wikiSpaceId = seeded.space.space.id
    const actorId = seeded.space.currentActor.id

    const sourceSnapshot = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${wikiSpaceId}/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )
    await expect(sourceSnapshot.json()).resolves.toMatchObject({
      sources: [expect.objectContaining({ id: seeded.sourceId })],
    })

    const proposalResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${wikiSpaceId}/pages/propose`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ actorId, sourceId: seeded.sourceId }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(proposalResponse.status).toBe(200)
    const proposal = (await proposalResponse.json()) as {
      reviewItem: { id: string }
    }

    const approvalResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${wikiSpaceId}/reviews/${proposal.reviewItem.id}/resolve`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ actorId, resolution: `approve` }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(approvalResponse.status).toBe(200)

    const finalSnapshot = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${wikiSpaceId}/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )
    await expect(finalSnapshot.json()).resolves.toMatchObject({
      wiki_pages: [expect.objectContaining({ status: `canonical` })],
      review_items: [expect.objectContaining({ status: `approved` })],
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

  it(`creates spaces over REST`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(`content-type`)).toBe(
      `application/json; charset=utf-8`
    )
    const snapshot = (await response.json()) as {
      space: { id: string; memberCount: number; createdByActorId: string }
      currentActor: { id: string; wikiSpaceId: string; displayName: string }
      actors: unknown[]
    }
    expect(snapshot.space.id).toMatch(/^wiki_/)
    expect(snapshot.space.memberCount).toBe(1)
    expect(snapshot.currentActor.id).toBe(snapshot.space.createdByActorId)
    expect(snapshot.currentActor.wikiSpaceId).toBe(snapshot.space.id)
    expect(snapshot.actors).toHaveLength(1)
  })

  it(`exposes Worker-local shared-state rows after REST create`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as { space: { id: string } }

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    const rows = (await response.json()) as {
      wiki_spaces: unknown[]
      actors: unknown[]
      memberships: Array<{ role: string }>
      activity_events: Array<{ event_type: string }>
      sources: unknown[]
    }
    expect(rows.wiki_spaces).toHaveLength(1)
    expect(rows.actors).toHaveLength(1)
    expect(rows.memberships).toEqual([
      expect.objectContaining({ role: `owner` }),
    ])
    expect(rows.activity_events).toEqual([
      expect.objectContaining({ event_type: `space_created` }),
    ])
    expect(rows.sources).toEqual([])
  })

  it(`joins spaces over REST using the URL space id`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as { space: { id: string } }

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/join`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            wikiSpaceId: `wiki_wrong`,
            displayName: `Bob`,
            avatarColor: `green`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    const snapshot = (await response.json()) as {
      space: { id: string; memberCount: number }
      currentActor: { displayName: string }
    }
    expect(snapshot.space.id).toBe(created.space.id)
    expect(snapshot.space.memberCount).toBe(2)
    expect(snapshot.currentActor.displayName).toBe(`Bob`)
  })

  it(`gets spaces over REST using actorId from the query string`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as {
      space: { id: string }
      currentActor: { id: string }
    }

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}?actorId=${created.currentActor.id}`
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    const snapshot = (await response.json()) as { currentActor: { id: string } }
    expect(snapshot.currentActor.id).toBe(created.currentActor.id)
  })

  it(`returns 400 JSON for invalid REST payloads`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: ``,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })

  it(`returns an empty shared-state snapshot when Worker-local space memory is missing`, async () => {
    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/wiki_missing/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      wiki_spaces: [],
      actors: [],
      memberships: [],
      activity_events: [],
      sources: [],
      wiki_pages: [],
      wiki_links: [],
      review_items: [],
      agent_runs: [],
    })
  })

  it(`returns 404 JSON for unknown REST spaces`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces/wiki_missing`),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: `Space not found`,
    })
  })

  it(`returns 404 JSON for unknown REST current actors`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as {
      space: { id: string }
      currentActor: { id: string }
    }
    const missingActorId = `${created.currentActor.id}_missing`

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}?actorId=${missingActorId}`
      ),
      env,
      {} as ExecutionContext
    )

    const text = await response.text()
    expect(response.status, text).toBe(404)
    const body = JSON.parse(text) as { ok: false; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain(`Actor not found`)
  })

  it(`submits non-fetch source rows over REST`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as {
      space: { id: string }
      currentActor: { id: string }
    }

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/sources`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            kind: `url`,
            title: `Electric Agents`,
            url: `https://electric-sql.com/docs/agents`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      source: { status: string; kind: string; url: string }
      activityEventId: string
    }
    expect(body.source).toMatchObject({
      status: `submitted`,
      kind: `url`,
      url: `https://electric-sql.com/docs/agents`,
    })
    expect(body.activityEventId).toMatch(/^event_/)

    const snapshotResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/shared-state-snapshot`
      ),
      env,
      {} as ExecutionContext
    )
    const rows = (await snapshotResponse.json()) as {
      sources: unknown[]
      activity_events: Array<{ event_type: string }>
    }
    expect(rows.sources).toHaveLength(1)
    expect(rows.activity_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: `source_submitted` }),
      ])
    )
  })

  it(`rejects source submissions from unknown actors`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as { space: { id: string } }

    const response = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/sources`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: `actor_missing`,
            kind: `text`,
            title: `Private note`,
            body: `Short note`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: `Actor not found`,
    })
  })

  it(`does not include configured token strings in REST space JSON`, async () => {
    const response = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )

    expect(response.status).toBe(200)
    await expect(response.text()).resolves.not.toContain(
      env.ELECTRIC_CLOUD_API_TOKEN
    )
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
    const missingActorId = `${created.currentActor.id}_missing`

    const response = await trpcRequest(
      `space.get`,
      { wikiSpaceId: created.space.id, actorId: missingActorId },
      `GET`
    )

    const text = await response.text()
    expect(response.status, text).toBe(404)
    const body = JSON.parse(text) as {
      error: { message: string; data: { code: string } }
    }
    expect(body.error.message).toContain(
      `Actor not found in WikiSpace ${created.space.id}: ${missingActorId}`
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
  it(`proposes and resolves page reviews over REST with controlled edge-case errors`, async () => {
    const createdResponse = await worker.fetch(
      new Request(`https://living-wiki.test/api/spaces`, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          title: `Demo`,
          displayName: `Alice`,
          avatarColor: `blue`,
        }),
      }),
      env,
      {} as ExecutionContext
    )
    const created = (await createdResponse.json()) as {
      space: { id: string }
      currentActor: { id: string }
    }

    const missingSource = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/pages/propose`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            sourceId: `source_missing`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(missingSource.status).toBe(400)
    await expect(missingSource.json()).resolves.toMatchObject({
      ok: false,
      error: `Source not found`,
    })

    const missingActor = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/pages/propose`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ sourceId: `source_missing` }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(missingActor.status).toBe(400)

    const sourceResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/sources`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            kind: `text`,
            title: `Note`,
            body: `Body`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    const source = (await sourceResponse.json()) as { source: { id: string } }

    const proposalResponse = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/pages/propose`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            sourceId: source.source.id,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(proposalResponse.status).toBe(200)
    const proposal = (await proposalResponse.json()) as {
      page: { status: string }
      reviewItem: { id: string; status: string }
    }
    expect(proposal.page.status).toBe(`proposed`)
    expect(proposal.reviewItem.status).toBe(`open`)

    const invalidAction = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/reviews/${proposal.reviewItem.id}/resolve`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            resolution: `maybe`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(invalidAction.status).toBe(400)

    const missingReview = await worker.fetch(
      new Request(
        `https://living-wiki.test/api/spaces/${created.space.id}/reviews/review_missing/resolve`,
        {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            actorId: created.currentActor.id,
            resolution: `reject`,
          }),
        }
      ),
      env,
      {} as ExecutionContext
    )
    expect(missingReview.status).toBe(400)
  })
})
