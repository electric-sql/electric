import { describe, expect, it } from 'vitest'
import { buildElectricProxyTarget } from '../src/utils/server-utils'

function shapeTarget(query: string): URL {
  return buildElectricProxyTarget({
    incomingUrl: new URL(`http://server/_electric/electric/v1/shape?${query}`),
    electricUrl: `http://electric.local`,
    tenantId: `tenant-test`,
    principalUrl: `/principal/user%3Aowner%40example.com`,
    principalKind: `user`,
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

  it(`exposes the entity sandbox + dispatch_policy columns to the client`, () => {
    // The sandbox profile (Local / Docker / E2B) and pinned runner are read
    // from the synced entity row by the UI badges; if these columns are
    // dropped from the proxy allowlist the UI silently can't tell them apart.
    const target = shapeTarget(`table=entities`)

    const columns = target.searchParams.get(`columns`)
    expect(columns).toContain(`"sandbox"`)
    expect(columns).toContain(`"dispatch_policy"`)
    expect(columns).toContain(`"created_by"`)
    expect(target.searchParams.get(`where`)).toContain(
      `tenant_id = 'tenant-test'`
    )
    expect(target.searchParams.get(`where`)).toContain(`created_by =`)
    expect(target.searchParams.get(`where`)).toContain(
      `FROM entity_effective_permissions`
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

  it(`tenant-scopes users shapes and exposes only display columns`, () => {
    const target = shapeTarget(
      `table=users&where=${encodeURIComponent(`email ILIKE '%@example.com'`)}`
    )

    expect(target.searchParams.get(`table`)).toBe(`users`)
    const columns = target.searchParams.get(`columns`)
    expect(columns).toContain(`"display_name"`)
    expect(columns).toContain(`"email"`)
    expect(columns).toContain(`"avatar_url"`)
    expect(columns).not.toContain(`"auth_provider"`)
    expect(columns).not.toContain(`"auth_subject"`)
    expect(columns).not.toContain(`"profile"`)
    expect(columns).not.toContain(`"metadata"`)
    expect(target.searchParams.get(`where`)).toBe(
      `tenant_id = 'tenant-test' AND (email ILIKE '%@example.com')`
    )
  })

  it(`scopes effective permission shapes to the current principal and readable entities`, () => {
    const target = shapeTarget(`table=entity_effective_permissions`)
    const where = target.searchParams.get(`where`) ?? ``

    expect(target.searchParams.get(`table`)).toBe(
      `entity_effective_permissions`
    )
    const columns = target.searchParams.get(`columns`)
    expect(columns).toContain(`"entity_url"`)
    expect(columns).toContain(`"permission"`)
    expect(where).toContain(`tenant_id = 'tenant-test'`)
    expect(where).toContain(
      `(subject_kind = 'principal' AND subject_value = '/principal/user%3Aowner%40example.com')`
    )
    expect(where).toContain(
      `(subject_kind = 'principal_kind' AND subject_value = 'user')`
    )
    expect(where).toContain(`entity_url IN (`)
    expect(where).toContain(`FROM entities`)
    expect(where).toContain(`created_by =`)
    expect(where).toContain(`permission IN ('read', 'manage')`)
  })

  it(`scopes entity shapes to owner or read/manage effective grants with IN subqueries`, () => {
    const target = shapeTarget(`table=entities`)
    const where = target.searchParams.get(`where`) ?? ``

    expect(where).toContain(`tenant_id = 'tenant-test'`)
    expect(where).toContain(
      `created_by = '/principal/user%3Aowner%40example.com'`
    )
    expect(where).toContain(`url IN (`)
    expect(where).toContain(`FROM entity_effective_permissions`)
    expect(where).toContain(`permission IN ('read', 'manage')`)
    expect(where).toContain(
      `(subject_kind = 'principal_kind' AND subject_value = 'user')`
    )
    expect(where).not.toMatch(/\bEXISTS\b/i)
  })

  it(`scopes entity-url tables through readable entity URLs without correlated subqueries`, () => {
    const target = shapeTarget(`table=entity_dispatch_state`)
    const where = target.searchParams.get(`where`) ?? ``

    expect(where).toContain(`entity_url IN (`)
    expect(where).toContain(`SELECT url`)
    expect(where).toContain(`FROM entities`)
    expect(where).toContain(`url IN (`)
    expect(where).toContain(`FROM entity_effective_permissions`)
    expect(where).not.toMatch(/\bEXISTS\b/i)
    expect(where).not.toContain(`entity_dispatch_state.`)
  })

  it(`scopes entity type shapes to spawn/manage grants`, () => {
    const target = shapeTarget(`table=entity_types`)
    const where = target.searchParams.get(`where`) ?? ``

    expect(where).toContain(`name IN (`)
    expect(where).toContain(`FROM entity_type_permission_grants`)
    expect(where).toContain(`permission IN ('spawn', 'manage')`)
    expect(where).toContain(
      `(subject_kind = 'principal_kind' AND subject_value = 'user')`
    )
    expect(where).not.toMatch(/\bEXISTS\b/i)
  })
})
