import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { desktopServerFetch } from './server-fetch'
import type { DesktopServerFetchDeps } from './server-fetch'

const cloudServer = {
  id: `cloud-server`,
  name: `Cloud`,
  url: `http://localhost:8006/t/svc-example/v1/`,
  source: `electric-cloud`,
  tenantId: `svc-example`,
  desiredState: `connected`,
  localRuntimeEnabled: false,
} as const

function deps(): DesktopServerFetchDeps {
  return {
    getServers: () => [cloudServer],
    getAgentsToken: () => `agents-token`,
    getCloudAuthState: () => ({
      status: `signed-in`,
      email: `ilia@example.com`,
      name: `Ilia`,
      userId: `69691edf-b925-4745-9c34-d7082eeb93e9`,
      workspaces: [],
      error: null,
    }),
    injectDevPrincipalHeaders: (server) => ({
      ...server,
      headers: {
        'electric-principal': `user:e5736358-3d50-44c2-ba5c-598fc2743297`,
      },
    }),
  }
}

describe(`desktop server fetch`, () => {
  afterEach(() => {
    mock.restoreAll()
  })

  it(`overrides stale principals with Cloud principals for local Cloud mutations`, async () => {
    const fetchMock = mock.method(globalThis, `fetch`, async () => {
      return new Response(null, { status: 204 })
    })

    const response = await desktopServerFetch(deps(), {
      url: `http://localhost:8006/t/svc-example/v1/_electric/entities/horton/a/grants`,
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        'electric-principal': `user:stale-request-principal`,
      },
      body: `{}`,
    })

    assert.equal(response.status, 204)
    assert.equal(fetchMock.mock.callCount(), 1)
    const init = fetchMock.mock.calls[0]?.arguments[1] as
      | RequestInit
      | undefined
    const headers = new Headers(init?.headers)
    assert.equal(
      headers.get(`electric-principal`),
      `user:69691edf-b925-4745-9c34-d7082eeb93e9`
    )
    assert.equal(headers.has(`x-electric-asserted-user-id`), false)
    assert.equal(headers.get(`authorization`), `Bearer agents-token`)
  })
})
