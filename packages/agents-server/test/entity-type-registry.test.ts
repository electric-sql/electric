import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/index'
import { PostgresRegistry } from '../src/entity-registry'
import {
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'
import type { ElectricAgentsEntityType } from '../src/electric-agents-types'

function entityType(
  overrides: Partial<ElectricAgentsEntityType> = {}
): ElectricAgentsEntityType {
  return {
    name: `horton`,
    description: `Friendly capable assistant`,
    revision: 1,
    created_at: `2026-05-09T10:00:00.000Z`,
    updated_at: `2026-05-09T10:00:00.000Z`,
    state_schemas: { run: {} },
    serve_endpoint: `http://host.docker.internal:4448/_electric/builtin-agent-handler`,
    ...overrides,
  }
}

describe(`PostgresRegistry entity type registration`, () => {
  let db: ReturnType<typeof createDb>[`db`]
  let client: ReturnType<typeof createDb>[`client`]

  beforeAll(async () => {
    await resetElectricAgentsTestBackend()
    const connection = createDb(TEST_POSTGRES_URL)
    db = connection.db
    client = connection.client
  }, 120_000)

  beforeEach(async () => {
    await resetElectricAgentsTestBackend()
  }, 120_000)

  afterAll(async () => {
    await client?.end()
  }, 120_000)

  it(`persists and retrieves externally_writable_collections round-trip`, async () => {
    const registry = new PostgresRegistry(db, `tenant-a`)
    const externallyWritableCollections = {
      comments: { type: `state:comments`, contract: `comments/v1` },
    }
    await registry.createEntityType(
      entityType({
        externally_writable_collections: externallyWritableCollections,
      })
    )
    const result = await registry.getEntityType(`horton`)
    expect(result?.externally_writable_collections).toEqual(
      externallyWritableCollections
    )
  })

  it(`upserts entity types against the tenant-scoped primary key`, async () => {
    const tenantA = new PostgresRegistry(db, `tenant-a`)
    const tenantB = new PostgresRegistry(db, `tenant-b`)

    await tenantA.createEntityType(entityType())
    await tenantA.createEntityType(
      entityType({
        description: `Friendly capable assistant v2`,
        revision: 2,
        updated_at: `2026-05-09T10:05:00.000Z`,
      })
    )
    await tenantB.createEntityType(
      entityType({
        description: `Tenant B horton`,
        revision: 3,
      })
    )

    expect(await tenantA.getEntityType(`horton`)).toMatchObject({
      name: `horton`,
      description: `Friendly capable assistant v2`,
      revision: 2,
    })
    expect(await tenantB.getEntityType(`horton`)).toMatchObject({
      name: `horton`,
      description: `Tenant B horton`,
      revision: 3,
    })
  })
})
