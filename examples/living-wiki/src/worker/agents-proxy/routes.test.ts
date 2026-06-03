import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleAgentsProxyRequest } from './routes'
import type { WorkerEnv } from '../env'
import {
  resetLocalDemoWikiSpaceStoreForTests,
  seedLocalDemoWikiSpace,
} from '../wiki-space-store'

const secretToken = `super-secret-token`
const env: WorkerEnv = {
  APP_ENV: `test`,
  ELECTRIC_CLOUD_API_URL: `https://cloud.example`,
  ELECTRIC_AGENTS_SPACE_ID: `space`,
  ELECTRIC_AGENTS_BASE_URL: `https://agents.example/base/`,
  ELECTRIC_AGENTS_TOKEN: secretToken,
  ELECTRIC_AGENTS_PRINCIPAL_KEY: `server-principal`,
}

const unconfiguredEnv: WorkerEnv = {
  ...env,
  ELECTRIC_AGENTS_BASE_URL: undefined,
}

function makeRequest(path: string, method: string = `GET`): Request {
  return new Request(`https://app.test${path}`, { method })
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetLocalDemoWikiSpaceStoreForTests()
})

async function expectErrorJson(
  response: Response,
  status: number
): Promise<{ ok: boolean; error: string }> {
  expect(response.status).toBe(status)
  expect(response.headers.get(`content-type`)).toBe(
    `application/json; charset=utf-8`
  )
  const body = (await response.json()) as { ok: boolean; error: string }
  expect(body).toHaveProperty(`ok`, false)
  expect(body).toHaveProperty(`error`)
  expect(typeof body.error).toBe(`string`)
  return body
}

describe(`agents proxy route handler`, () => {
  describe(`non-matching paths return undefined`, () => {
    it.each([
      `/api/health`,
      `/api/spaces`,
      `/other`,
      `/`,
      `/api/agents`,
      `/api/agents/entities`,
      `/api/agents/entities/space1/wiki-space/id1`,
      `/api/agents/entities/space1/wiki-space/id1/stream/extra`,
      `/api/observe`,
      `/api/observe/space1`,
      `/api/observe/space1/entities/extra`,
    ])(`returns undefined for %s`, async (path) => {
      const result = await handleAgentsProxyRequest(makeRequest(path), env)
      expect(result).toBeUndefined()
    })
  })

  describe(`entity stream route — method enforcement`, () => {
    const entityPath = `/api/agents/entities/space1/wiki-space/id1/stream`

    it.each([`POST`, `PUT`, `DELETE`, `PATCH`])(
      `returns 405 for %s`,
      async (method) => {
        const response = await handleAgentsProxyRequest(
          makeRequest(entityPath, method),
          env
        )
        expect(response).toBeDefined()
        const body = await expectErrorJson(response!, 405)
        expect(body.error).toBe(`Method not allowed`)
      }
    )
  })

  describe(`observe route — method enforcement`, () => {
    const observePath = `/api/observe/space1/entities`

    it.each([`POST`, `PUT`, `DELETE`, `PATCH`])(
      `returns 405 for %s`,
      async (method) => {
        const response = await handleAgentsProxyRequest(
          makeRequest(observePath, method),
          env
        )
        expect(response).toBeDefined()
        const body = await expectErrorJson(response!, 405)
        expect(body.error).toBe(`Method not allowed`)
      }
    )
  })

  describe(`entity stream route — invalid entity kind`, () => {
    it(`returns 400 for unknown entity kind`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/unknown-kind/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      const body = await expectErrorJson(response!, 400)
      expect(body.error).toBe(`Invalid request`)
    })

    it.each([`page`, `document`, `WIKI-SPACE`, `Wiki-Space`])(
      `returns 400 for entity kind "%s"`,
      async (kind) => {
        const response = await handleAgentsProxyRequest(
          makeRequest(`/api/agents/entities/space1/${kind}/id1/stream`),
          env
        )
        expect(response).toBeDefined()
        await expectErrorJson(response!, 400)
      }
    )
  })

  describe(`entity stream route — invalid IDs`, () => {
    it(`returns 400 for wikiSpaceId containing encoded slash`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space%2f1/wiki-space/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`returns 400 for entityId containing encoded slash`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/wiki-space/id%2f1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`returns 400 for wikiSpaceId with path traversal`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space..1/wiki-space/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`returns 400 for entityId with path traversal`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/wiki-space/id..1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`returns 400 for wikiSpaceId with special characters`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space%20one/wiki-space/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })
  })

  describe(`observe route — invalid observe kind`, () => {
    it(`returns 400 for unknown observe kind`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space1/unknown-kind`),
        env
      )
      expect(response).toBeDefined()
      const body = await expectErrorJson(response!, 400)
      expect(body.error).toBe(`Invalid request`)
    })

    it.each([`events`, `logs`, `ENTITIES`, `Shared-State`])(
      `returns 400 for observe kind "%s"`,
      async (kind) => {
        const response = await handleAgentsProxyRequest(
          makeRequest(`/api/observe/space1/${kind}`),
          env
        )
        expect(response).toBeDefined()
        await expectErrorJson(response!, 400)
      }
    )
  })

  describe(`observe route — invalid wikiSpaceId`, () => {
    it(`returns 400 for wikiSpaceId containing encoded slash`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space%2f1/entities`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`returns 400 for wikiSpaceId with path traversal`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space..1/entities`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })
  })

  describe(`principal derivation`, () => {
    it(`uses the verified demo actor display name as the upstream principal`, async () => {
      await seedLocalDemoWikiSpace({
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_ada`,
        title: `Demo`,
        displayName: `Ada Lovelace`,
        avatarColor: `blue`,
        createdAt: `2026-06-03T00:00:00.000Z`,
      })
      const calls: RequestInit[] = []
      vi.stubGlobal(
        `fetch`,
        vi.fn(async (_input, init) => {
          calls.push(init ?? {})
          return new Response(`ok`)
        })
      )

      const response = await handleAgentsProxyRequest(
        new Request(
          `https://app.test/api/observe/wiki_demo/shared-state?actorId=actor_ada&offset=1`,
          {
            headers: {
              'electric-principal': `browser-supplied`,
            },
          }
        ),
        env
      )

      expect(response).toBeDefined()
      expect(await response!.text()).toBe(`ok`)
      const headers = new Headers(calls[0].headers)
      expect(headers.get(`electric-principal`)).toBe(`Ada Lovelace`)
      expect(headers.get(`authorization`)).toBe(`Bearer ${secretToken}`)
    })

    it(`returns 400 when actorId is not a member of the wiki space`, async () => {
      await seedLocalDemoWikiSpace({
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_ada`,
        title: `Demo`,
        displayName: `Ada Lovelace`,
        avatarColor: `blue`,
        createdAt: `2026-06-03T00:00:00.000Z`,
      })

      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/wiki_demo/shared-state?actorId=actor_grace`),
        env
      )

      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })
  })

  describe(`503 when agents proxy is not configured`, () => {
    it(`returns 503 for entity stream when base URL is undefined`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/wiki-space/id1/stream`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      const body = await expectErrorJson(response!, 503)
      expect(body.error).toBe(`Agents proxy is not configured`)
    })

    it(`returns 503 for entities observe when base URL is undefined`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space1/entities`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      const body = await expectErrorJson(response!, 503)
      expect(body.error).toBe(`Agents proxy is not configured`)
    })

    it(`returns 503 for shared-state observe when base URL is undefined`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space1/shared-state`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      const body = await expectErrorJson(response!, 503)
      expect(body.error).toBe(`Agents proxy is not configured`)
    })
  })

  describe(`error responses never leak the secret token`, () => {
    it(`400 error body does not contain the token`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/unknown-kind/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      const text = await response!.text()
      expect(text).not.toContain(secretToken)
    })

    it(`405 error body does not contain the token`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(
          `/api/agents/entities/space1/wiki-space/id1/stream`,
          `POST`
        ),
        env
      )
      expect(response).toBeDefined()
      const text = await response!.text()
      expect(text).not.toContain(secretToken)
    })

    it(`503 error body does not contain the token`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/wiki-space/id1/stream`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      const text = await response!.text()
      expect(text).not.toContain(secretToken)
    })

    it(`observe 400 error body does not contain the token`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space1/unknown-kind`),
        env
      )
      expect(response).toBeDefined()
      const text = await response!.text()
      expect(text).not.toContain(secretToken)
    })

    it(`observe 503 error body does not contain the token`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/observe/space1/entities`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      const text = await response!.text()
      expect(text).not.toContain(secretToken)
    })
  })

  describe(`error responses have correct JSON shape`, () => {
    it(`405 has {ok: false, error: string}`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(
          `/api/agents/entities/space1/wiki-space/id1/stream`,
          `DELETE`
        ),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 405)
    })

    it(`400 has {ok: false, error: string}`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/bad-kind/id1/stream`),
        env
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 400)
    })

    it(`503 has {ok: false, error: string}`, async () => {
      const response = await handleAgentsProxyRequest(
        makeRequest(`/api/agents/entities/space1/wiki-space/id1/stream`),
        unconfiguredEnv
      )
      expect(response).toBeDefined()
      await expectErrorJson(response!, 503)
    })
  })
})
