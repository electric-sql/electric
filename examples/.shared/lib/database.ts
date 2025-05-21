import { execSync } from 'node:child_process'
import { createNeonDb, getNeonConnectionString } from './neon'

function addDatabaseToElectric({
  dbUri,
  pooledDbUri,
}: {
  dbUri: $util.Input<string>
  pooledDbUri?: $util.Input<string>
}): $util.Output<{ id: string; source_secret: string }> {
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

  const createCommand = `curl --fail-with-body -s -X PUT $ADMIN_API_URL/v1/sources \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $ADMIN_API_TOKEN" \
        -d $SOURCE_CONFIG`

  // TODO: replace with Pulumi Electric provider when available
  const electricSourceCommand = new command.local.Command(
    `electric-create-source-command`,
    {
      create: createCommand,
      update: createCommand,

      // The delete command will use the JSON output from the create command
      // to get the source ID, and will wait for a bit to ensure source is cleaned up
      delete: `curl --fail-with-body -s -X DELETE $ADMIN_API_URL/v1/sources/$(echo $PULUMI_COMMAND_STDOUT | jq -r .id) \
        -H "Authorization: Bearer $ADMIN_API_TOKEN" \
        && sleep 10`,
      addPreviousOutputInEnv: true,
      environment: {
        ADMIN_API_URL: adminApi,
        ADMIN_API_TOKEN: adminApiAuthToken,
        SOURCE_CONFIG: $jsonStringify({
          database_url: dbUri,
          options: {
            db_pool_size: 5,
            ...(pooledDbUri ? { pooled_database_url: pooledDbUri } : {}),
          },
          region: `us-east-1`,
          team_id: teamId,
        }),
      },
    }
  )

  return electricSourceCommand.stdout.apply((output) => {
    const parsedOutput = JSON.parse(output) as {
      id: string
      source_secret: string
    }
    console.log(
      `Created Electric source:`,
      parsedOutput.id !== undefined ? parsedOutput.id : output
    )
    return parsedOutput
  })
}

export function applyMigrations(
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

  const electricInfo = addDatabaseToElectric({
    dbUri: databaseUri,
    pooledDbUri: pooledDatabaseUri,
  })

  const res = {
    sourceId: electricInfo.id,
    sourceSecret: electricInfo.source_secret,
    databaseUri,
    pooledDatabaseUri,
  }

  if (migrationsDirectory) {
    return databaseUri
      .apply((uri) => applyMigrations(uri, migrationsDirectory))
      .apply(() => res)
  }

  return res
}
