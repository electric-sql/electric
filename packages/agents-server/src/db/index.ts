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
    fetch_types: false,
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

export async function runMigrations(postgresUrl: string): Promise<void> {
  const migrationClient = postgres(postgresUrl, {
    max: 1,
    onnotice: () => {},
  })
  const db = drizzle(migrationClient)
  await migrate(db, {
    migrationsFolder: resolveMigrationsFolder(),
  })
  await migrationClient.end()
}
