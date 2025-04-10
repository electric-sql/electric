import { execSync } from 'node:child_process'
import { createNeonDb, getNeonConnectionString } from './neon'

async function addDatabaseToElectric({
  dbUri,
  pooledDbUri,
}: {
  dbUri: string
  pooledDbUri?: string
}): Promise<{ id: string; source_secret: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  if (!adminApi || !teamId) {
    throw new Error(`ELECTRIC_ADMIN_API or ELECTRIC_TEAM_ID is not set`)
  }

  const adminApiAuthToken = process.env.ELECTRIC_ADMIN_API_AUTH_TOKEN
  if (!adminApiAuthToken) {
    throw new Error(
      `ADMIN_API_TOKEN_CLIENT_ID or ADMIN_API_TOKEN_CLIENT_SECRET is not set`
    )
  }

  const result = await fetch(`${adminApi}/v1/sources`, {
    method: `PUT`,
    headers: {
      'Content-Type': `application/json`,
      Authorization: `Bearer ${adminApiAuthToken}`,
    },
    body: JSON.stringify({
      database_url: dbUri,
      source_options: {
        db_pool_size: 5,
        ...(pooledDbUri ? { pooledDbUri } : {}),
      },
      region: `us-east-1`,
      team_id: teamId,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}

function applyMigrations(
  dbUri: string,
  migrationsDir: string = `./db/migrations`
) {
  execSync(`pnpm exec pg-migrations apply --directory ${migrationsDir}`, {
    env: {
      ...process.env,
      DATABASE_URL: dbUri,
    },
  })
}

export function createDatabaseForCloudElectric({
  dbName,
  migrationsDirectory,
}: {
  dbName: string
  migrationsDirectory: string
}) {
  const neonProjectId = process.env.NEON_PROJECT_ID
  if (!neonProjectId) {
    throw new Error(`NEON_PROJECT_ID is not set`)
  }

  const project = neon.getProjectOutput({
    id: neonProjectId,
  })
  const { ownerName, dbName: resultingDbName } = createNeonDb({
    projectId: project.id,
    branchId: project.defaultBranchId,
    dbName,
  })

  const databaseUri = getNeonConnectionString({
    project,
    roleName: ownerName,
    databaseName: resultingDbName,
    pooled: false,
  })
  const pooledDatabaseUri = getNeonConnectionString({
    project,
    roleName: ownerName,
    databaseName: resultingDbName,
    pooled: true,
  })

  if (migrationsDirectory) {
    databaseUri.apply((uri) => applyMigrations(uri, migrationsDirectory))
  }

  const electricInfo = $resolve([databaseUri, pooledDatabaseUri]).apply(
    ([dbUri, pooledDbUri]) => addDatabaseToElectric({ dbUri, pooledDbUri })
  )

  return {
    sourceId: electricInfo.id,
    sourceSecret: electricInfo.source_secret,
    databaseUri,
    pooledDatabaseUri,
  }
}
