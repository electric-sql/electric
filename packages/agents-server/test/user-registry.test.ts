import { describe, expect, it, vi } from 'vitest'
import { PostgresRegistry } from '../src/entity-registry'
import { parsePrincipalKey } from '../src/principal'

describe(`PostgresRegistry users`, () => {
  it(`duplicates user principals into tenant-scoped users`, async () => {
    const { registry, db } = fakeRegistry()

    await registry.ensureUserForPrincipal(parsePrincipalKey(`user:alice`))

    expect(db.insertValues).toEqual({
      tenantId: `tenant-a`,
      id: `alice`,
    })
    expect(db.onConflictDoNothing).toHaveBeenCalled()
  })

  it(`ignores non-user principals`, async () => {
    const { registry, db } = fakeRegistry()

    await registry.ensureUserForPrincipal(parsePrincipalKey(`service:github`))

    expect(db.insert).not.toHaveBeenCalled()
  })
})

function fakeRegistry() {
  const db = {
    insertValues: undefined as unknown,
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        db.insertValues = values
        return {
          onConflictDoNothing: db.onConflictDoNothing,
        }
      }),
    })),
    onConflictDoNothing: vi.fn(async () => undefined),
  }

  return {
    db,
    registry: new PostgresRegistry(db as never, `tenant-a`),
  }
}
