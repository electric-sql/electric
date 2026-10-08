import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.js'

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>
export type PgClient = ReturnType<typeof postgres>

export function createDb(postgresUrl: string): {
  db: DrizzleDB
  client: PgClient
} {
  const poolMax = Number(process.env.ELECTRIC_AGENTS_PG_POOL_MAX ?? `100`)
  const client = postgres(postgresUrl, {
    max: poolMax,
    fetch_types: true,
  })
  const db = drizzle(client, { schema })
  return { db, client }
}

export function resolveMigrationsFolder(fromUrl = import.meta.url): string {
  const here = dirname(fileURLToPath(fromUrl))
  const candidates = [
    resolve(here, `../../drizzle`),
    resolve(here, `../drizzle`),
    resolve(process.cwd(), `packages/agents-server/drizzle`),
  ]

  const folder = candidates.find((candidate) => existsSync(candidate))
  if (!folder) {
    throw new Error(
      `Could not locate agent-server migrations directory from ${fromUrl}`
    )
  }

  return folder
}

async function migrateClient(client: PgClient): Promise<void> {
  const db = drizzle(client)
  await migrate(db, {
    migrationsFolder: resolveMigrationsFolder(),
  })
}

/**
 * Runs migrations with a library-owned client that is always closed.
 */
export function runMigrations(postgresUrl: string): Promise<void>
/**
 * Runs migrations with a caller-owned client that is never closed.
 *
 * The caller remains responsible for closing the client after success or
 * failure.
 */
export function runMigrations(client: PgClient): Promise<void>
export async function runMigrations(
  postgresUrlOrClient: string | PgClient
): Promise<void> {
  if (typeof postgresUrlOrClient !== `string`) {
    await migrateClient(postgresUrlOrClient)
    return
  }

  const migrationClient = postgres(postgresUrlOrClient, {
    max: 1,
    onnotice: () => {},
  })
  try {
    await migrateClient(migrationClient)
  } finally {
    await migrationClient.end()
  }
}
