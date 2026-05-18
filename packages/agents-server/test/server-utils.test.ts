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
    const columns = target.searchParams.get(`columns`)
    expect(columns).toContain(`"owner_principal"`)
    expect(columns).not.toContain(`"diagnostics"`)
    expect(columns).not.toContain(`"last_seen_at"`)
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

  it(`owner-scopes runner runtime diagnostics shapes and preserves runner filters`, () => {
    const target = shapeTarget(
      `table=runner_runtime_diagnostics&where=${encodeURIComponent(`runner_id = 'runner-1'`)}`
    )

    expect(target.searchParams.get(`table`)).toBe(`runner_runtime_diagnostics`)
    expect(target.searchParams.get(`columns`)).toContain(`"diagnostics"`)
    expect(target.searchParams.get(`where`)).toBe(
      `tenant_id = 'tenant-test' AND owner_principal = '/principal/user%3Aowner%40example.com' AND (runner_id = 'runner-1')`
    )
  })
})
