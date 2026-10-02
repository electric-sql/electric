import postgres from 'postgres'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import { runMigrations } from '../src/index'
import type { PgClient } from '../src/index'

const { drizzleMock, migrateMock, postgresMock } = vi.hoisted(() => ({
  drizzleMock: vi.fn(),
  migrateMock: vi.fn(async () => {}),
  postgresMock: vi.fn((_postgresUrl: string) => ({
    end: vi.fn(async () => {}),
  })),
}))

vi.mock(`postgres`, () => ({
  default: postgresMock,
}))

vi.mock(`drizzle-orm/postgres-js`, () => ({
  drizzle: drizzleMock,
}))

vi.mock(`drizzle-orm/postgres-js/migrator`, () => ({
  migrate: migrateMock,
}))

const syntheticPostgresUrl = `postgresql://db.invalid/agents`
const migrationDb = { kind: `migration-db` }

function compilePublicMigrationCalls(client: PgClient): void {
  void runMigrations(syntheticPostgresUrl)
  void runMigrations(client)
}

function createCallerOwnedClient() {
  const endMock = vi.fn(async () => {})
  postgresMock.mockReturnValueOnce({ end: endMock })
  const client = postgres(syntheticPostgresUrl)
  postgresMock.mockClear()
  return { client, endMock }
}

describe(`runMigrations`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    drizzleMock.mockReturnValue(migrationDb)
    migrateMock.mockResolvedValue(undefined)
  })

  it(`accepts URL and PgClient inputs through the package root`, () => {
    expectTypeOf(compilePublicMigrationCalls).returns.toEqualTypeOf<void>()
  })

  it(`uses a caller-owned client without closing it after success`, async () => {
    const { client, endMock } = createCallerOwnedClient()

    await runMigrations(client)

    expect(postgresMock).not.toHaveBeenCalled()
    expect(drizzleMock).toHaveBeenCalledOnce()
    expect(drizzleMock.mock.calls.at(0)?.at(0)).toBe(client)
    expect(migrateMock).toHaveBeenCalledWith(migrationDb, {
      migrationsFolder: expect.any(String),
    })
    expect(endMock).not.toHaveBeenCalled()
  })

  it(`does not close a caller-owned client after migration failure`, async () => {
    const migrationError = new Error(`migration failed`)
    const { client, endMock } = createCallerOwnedClient()
    migrateMock.mockRejectedValueOnce(migrationError)

    await expect(runMigrations(client)).rejects.toBe(migrationError)

    expect(postgresMock).not.toHaveBeenCalled()
    expect(drizzleMock).toHaveBeenCalledOnce()
    expect(drizzleMock.mock.calls.at(0)?.at(0)).toBe(client)
    expect(endMock).not.toHaveBeenCalled()
  })

  it(`closes a URL-created client after success`, async () => {
    const endMock = vi.fn(async () => {})
    const libraryOwnedClient = { end: endMock }
    postgresMock.mockReturnValueOnce(libraryOwnedClient)

    await runMigrations(syntheticPostgresUrl)

    expect(postgresMock).toHaveBeenCalledWith(syntheticPostgresUrl, {
      max: 1,
      onnotice: expect.any(Function),
    })
    expect(drizzleMock.mock.calls.at(0)?.at(0)).toBe(libraryOwnedClient)
    expect(endMock).toHaveBeenCalledOnce()
  })

  it(`closes a URL-created client after migration failure`, async () => {
    const migrationError = new Error(`migration failed`)
    const endMock = vi.fn(async () => {})
    const libraryOwnedClient = { end: endMock }
    postgresMock.mockReturnValueOnce(libraryOwnedClient)
    migrateMock.mockRejectedValueOnce(migrationError)

    await expect(runMigrations(syntheticPostgresUrl)).rejects.toBe(
      migrationError
    )

    expect(drizzleMock.mock.calls.at(0)?.at(0)).toBe(libraryOwnedClient)
    expect(endMock).toHaveBeenCalledOnce()
  })
})
