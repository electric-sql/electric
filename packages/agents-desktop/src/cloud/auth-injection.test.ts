import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildCloudAuthHeaders, buildSavedServerHeaders } from './auth-headers'
import { mergeHeaders } from '../shared/headers'
import type { CloudAuthHeaderInjectionDeps } from './auth-headers'

const cloudServer = {
  id: `cloud-server`,
  name: `Cloud`,
  url: `http://localhost:8006/t/svc-example/v1/`,
  source: `electric-cloud`,
  tenantId: `svc-example`,
  desiredState: `connected`,
  localRuntimeEnabled: false,
} as const

function deps(
  overrides: Partial<CloudAuthHeaderInjectionDeps> = {}
): CloudAuthHeaderInjectionDeps {
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
    injectDevPrincipalHeaders: (server) => server,
    ...overrides,
  }
}

describe(`cloud auth header injection`, () => {
  it(`injects the signed-in Cloud user as the Electric principal`, () => {
    const headers = buildCloudAuthHeaders(
      deps(),
      `http://localhost:8006/t/svc-example/v1/_electric/entities/horton/a`
    )

    assert.deepEqual(headers, {
      Authorization: `Bearer agents-token`,
      'electric-principal': `user:69691edf-b925-4745-9c34-d7082eeb93e9`,
      'x-electric-asserted-email': `ilia@example.com`,
      'x-electric-asserted-name': `Ilia`,
    })
  })

  it(`lets Cloud principal headers override stale saved server principals`, () => {
    const requestUrl = `http://localhost:8006/t/svc-example/v1/_electric/entities/horton/a/grants`
    const staleSavedHeaders = buildSavedServerHeaders(
      deps({
        injectDevPrincipalHeaders: (server) => ({
          ...server,
          headers: {
            'electric-principal': `user:e5736358-3d50-44c2-ba5c-598fc2743297`,
          },
        }),
      }),
      requestUrl
    )
    const cloudHeaders = buildCloudAuthHeaders(deps(), requestUrl)
    const merged = mergeHeaders(
      staleSavedHeaders ?? undefined,
      cloudHeaders ?? undefined
    )

    assert.equal(
      merged?.[`electric-principal`],
      `user:69691edf-b925-4745-9c34-d7082eeb93e9`
    )
  })

  it(`does not inject a service bearer without a signed-in Cloud principal`, () => {
    const headers = buildCloudAuthHeaders(
      deps({
        getCloudAuthState: () => ({
          status: `signed-in`,
          email: `ilia@example.com`,
          name: `Ilia`,
          userId: null,
          workspaces: null,
          error: null,
        }),
      }),
      `http://localhost:8006/t/svc-example/v1/_electric/entities/horton/a`
    )

    assert.equal(headers, null)
  })
})
