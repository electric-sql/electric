import { describe, expect, it } from 'vitest'
import { buildElectricProxyTarget } from '../src/utils/server-utils'

function shapeTarget(query: string): URL {
  return buildElectricProxyTarget({
    incomingUrl: new URL(`http://server/_electric/electric/v1/shape?${query}`),
    electricUrl: `http://electric.local`,
    tenantId: `tenant-test`,
    principalUrl: `/principal/user%3Aowner%40example.com`,
  })
}

describe(`server utils`, () => {
  it(`owner-scopes runner shapes to the authenticated principal`, () => {
    const target = shapeTarget(`table=runners`)

    expect(target.pathname).toBe(`/v1/shape`)
    expect(target.searchParams.get(`table`)).toBe(`runners`)
    expect(target.searchParams.get(`columns`)).toContain(`"owner_principal"`)
    expect(target.searchParams.get(`where`)).toBe(
      `tenant_id = 'tenant-test' AND owner_principal = '/principal/user%3Aowner%40example.com'`
    )
  })

  it(`combines runner owner scoping with Electric protocol where clauses`, () => {
    const target = shapeTarget(
      `table=runners&where=${encodeURIComponent(`kind = 'local'`)}`
    )

    expect(target.searchParams.get(`where`)).toBe(
      `tenant_id = 'tenant-test' AND owner_principal = '/principal/user%3Aowner%40example.com' AND (kind = 'local')`
    )
  })
})
