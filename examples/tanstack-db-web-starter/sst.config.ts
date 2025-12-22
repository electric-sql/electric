/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "node:child_process"
import { isProduction } from "../.shared/lib/infra"
import { createNeonDb, getNeonConnectionStrings } from "../.shared/lib/neon"

export default $config({
  app(input) {
    return {
      name: `quickstart-example`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    // Validate required environment variables
    if (!process.env.ELECTRIC_API) {
      throw new Error(`ELECTRIC_API environment variable is required`)
    }
    if (!process.env.BETTER_AUTH_SECRET) {
      throw new Error(`BETTER_AUTH_SECRET environment variable is required`)
    }

    const dbName = isProduction()
      ? `quickstart-production`
      : `quickstart-${$app.stage}`

    const dbConfig = getQuickstartSource(dbName)

    const website = new sst.aws.TanStackStart(`quickstart-website`, {
      environment: {
        // Database
        DATABASE_URL: dbConfig.pooledDatabaseUri,

        // Electric
        ELECTRIC_URL: process.env.ELECTRIC_API,
        ELECTRIC_SOURCE_ID: dbConfig.sourceId,
        ELECTRIC_SOURCE_SECRET: dbConfig.sourceSecret,

        // Better Auth
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: `https://quickstart${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
      },
      domain: {
        name: `quickstart${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      website: website.url,
    }
  },
})

// -----------------------------------------------------------------------------
// Database helpers
// -----------------------------------------------------------------------------

/**
 * Get or create a database for the quickstart.
 * - Production: Uses pre-configured credentials from environment
 * - PR stages: Creates a new Neon database via API
 */
function getQuickstartSource(dbName: string) {
  if (isProduction()) {
    if (
      !process.env.QUICKSTART_DATABASE_URI ||
      !process.env.QUICKSTART_POOLED_DATABASE_URI ||
      !process.env.QUICKSTART_SOURCE_ID ||
      !process.env.QUICKSTART_SOURCE_SECRET
    ) {
      throw new Error(
        `Production requires QUICKSTART_DATABASE_URI, QUICKSTART_POOLED_DATABASE_URI, ` +
          `QUICKSTART_SOURCE_ID, and QUICKSTART_SOURCE_SECRET`
      )
    }

    const databaseUri = process.env.QUICKSTART_DATABASE_URI

    // Apply migrations (idempotent)
    applyDrizzleMigrations(databaseUri)

    return {
      sourceId: process.env.QUICKSTART_SOURCE_ID,
      sourceSecret: process.env.QUICKSTART_SOURCE_SECRET,
      databaseUri,
      pooledDatabaseUri: process.env.QUICKSTART_POOLED_DATABASE_URI,
    }
  }

  // PR stages: Create new database
  return createQuickstartDatabase({ dbName })
}

/**
 * Creates a new Neon database for PR stages and registers with Electric.
 */
function createQuickstartDatabase({ dbName }: { dbName: string }) {
  const neonProjectId = process.env.NEON_PROJECT_ID
  if (!neonProjectId) {
    throw new Error(`NEON_PROJECT_ID is not set`)
  }

  // Get default branch ID from Neon API
  type NeonBranchesResponse = {
    branches?: Array<{ id: string; default?: boolean }>
  }
  const branchesJson = JSON.parse(
    execSync(
      `curl -s -H "Authorization: Bearer $NEON_API_KEY" ` +
        `https://console.neon.tech/api/v2/projects/${neonProjectId}/branches`,
      { env: process.env }
    ).toString()
  ) as NeonBranchesResponse

  const defaultBranchId = branchesJson?.branches?.find((b) => b.default)?.id
  if (!defaultBranchId) {
    throw new Error(`Could not resolve Neon default branch id`)
  }

  // Create database
  const { ownerName, dbName: resultingDbName } = createNeonDb({
    projectId: neonProjectId,
    branchId: defaultBranchId,
    dbName,
  })

  // Get connection strings
  const connectionStrings = getNeonConnectionStrings({
    projectId: neonProjectId,
    branchId: defaultBranchId,
    roleName: ownerName,
    databaseName: resultingDbName,
  })

  const databaseUri = connectionStrings.direct
  const pooledDatabaseUri = connectionStrings.pooled

  // Register with Electric Cloud
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

  // Apply migrations after database is created
  return databaseUri
    .apply((uri) => applyDrizzleMigrations(uri))
    .apply(() => res)
}

/**
 * Apply migrations using Drizzle Kit.
 * Migrations are in src/db/out/ (generated by drizzle-kit generate).
 */
function applyDrizzleMigrations(dbUri: string) {
  console.log(`[quickstart] Applying Drizzle migrations`)
  execSync(`pnpm drizzle-kit migrate`, {
    env: {
      ...process.env,
      DATABASE_URL: dbUri,
    },
  })
}

/**
 * Register a database with Electric Cloud.
 */
function addDatabaseToElectric({
  dbUri,
  pooledDbUri,
}: {
  dbUri: $util.Input<string>
  pooledDbUri?: $util.Input<string>
}): $util.Output<{ id: string; source_secret: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID
  const adminApiAuthToken = process.env.ELECTRIC_ADMIN_API_AUTH_TOKEN

  if (!adminApi || !teamId || !adminApiAuthToken) {
    throw new Error(
      `ELECTRIC_ADMIN_API, ELECTRIC_TEAM_ID, and ELECTRIC_ADMIN_API_AUTH_TOKEN must be set`
    )
  }

  const createCommand = `curl --fail-with-body -s -X PUT $ADMIN_API_URL/v1/sources \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ADMIN_API_TOKEN" \
    -d $SOURCE_CONFIG`

  const electricSourceCommand = new command.local.Command(
    `quickstart-electric-source`,
    {
      create: createCommand,
      update: createCommand,
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
    return JSON.parse(output) as { id: string; source_secret: string }
  })
}
