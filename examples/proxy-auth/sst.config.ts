// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />
import { execSync } from "child_process"

const isProduction = (stage: string) => stage.toLowerCase() === `production`

const adminApiTokenId = process.env.ELECTRIC_ADMIN_API_TOKEN_ID
const adminApiTokenSecret = process.env.ELECTRIC_ADMIN_API_TOKEN_SECRET

export default $config({
  app(input) {
    return {
      name: `proxy-auth`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          region: `eu-west-1`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        postgresql: `3.14.0`,
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    if (!$dev && !process.env.ELECTRIC_ADMIN_API_TOKEN_ID) {
      throw new Error(`ELECTRIC_ADMIN_API_TOKEN_ID is not set`)
    }

    if (!$dev && !process.env.ELECTRIC_ADMIN_API_TOKEN_SECRET) {
      throw new Error(`ELECTRIC_ADMIN_API_TOKEN_ID is not set`)
    }

    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    const project = neon.getProjectOutput({
      id: process.env.NEON_PROJECT_ID!,
    })

    const dbName = isProduction($app.stage)
      ? `proxy-auth-production`
      : `proxy-auth-${$app.stage}`

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

    const electricInfo = databaseUri.apply((uri) => {
      return addDatabaseToElectric(uri)
    })

    const staticSite = new sst.aws.Nextjs(`proxy-auth`, {
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_TOKEN: electricInfo.token,
        DATABASE_ID: electricInfo.id,
      },
      domain: {
        name: `proxy-auth${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    databaseUri.apply(applyMigrations)

    return {
      databaseUri,
      databaseId: electricInfo.id,
      token: electricInfo.token,
      url: staticSite.url,
    }
  },
})

function applyMigrations(uri: string) {
  execSync(`pnpm exec pg-migrations apply --directory ./db/migrations`, {
    env: {
      ...process.env,
      DATABASE_URL: uri,
    },
  })
}
async function addDatabaseToElectric(
  uri: string
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  const result = await fetch(`${adminApi}/v1/sources`, {
    method: `PUT`,
    headers: {
      "Content-Type": `application/json`,
      "CF-Access-Client-Id": adminApiTokenId ?? ``,
      "CF-Access-Client-Secret": adminApiTokenSecret ?? ``,
    },
    body: JSON.stringify({
      database_url: uri,
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

function getNeonConnectionString({
  project,
  roleName,
  databaseName,
  pooled,
}: {
  project: $util.Output<neon.GetProjectResult>
  roleName: $util.Input<string>
  databaseName: $util.Input<string>
  pooled: boolean
}): $util.Output<string> {
  const passwordOutput = neon.getBranchRolePasswordOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
    roleName: roleName,
  })

  const endpoint = neon.getBranchEndpointsOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
  })
  const databaseHost = pooled
    ? endpoint.endpoints?.apply((endpoints) =>
        endpoints![0].host.replace(
          endpoints![0].id,
          endpoints![0].id + `-pooler`
        )
      )
    : project.databaseHost
  return $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${databaseHost}/${databaseName}?sslmode=require`
}

/**
 * Uses the [Neon API](https://neon.tech/docs/manage/databases) along with
 * a Pulumi Command resource and `curl` to create and delete Neon databases.
 */
function createNeonDb({
  projectId,
  branchId,
  dbName,
}: {
  projectId: $util.Input<string>
  branchId: $util.Input<string>
  dbName: $util.Input<string>
}): $util.Output<{
  dbName: string
  ownerName: string
}> {
  if (!process.env.NEON_API_KEY) {
    throw new Error(`NEON_API_KEY is not set`)
  }

  const ownerName = `neondb_owner`

  const createCommand = `curl -f -s "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases" \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $NEON_API_KEY" \
    -H 'Content-Type: application/json' \
    -d '{
      "database": {
        "name": "'$DATABASE_NAME'",
        "owner_name": "${ownerName}"
      }
    }' \
    && echo " SUCCESS" || echo " FAILURE"`

  const updateCommand = `echo "Cannot update Neon database with this provisioning method SUCCESS"`

  const deleteCommand = `curl -f -s -X 'DELETE' \
    "https://console.neon.tech/api/v2/projects/$PROJECT_ID/branches/$BRANCH_ID/databases/$DATABASE_NAME" \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $NEON_API_KEY" \
    && echo " SUCCESS" || echo " FAILURE"`

  const result = new command.local.Command(`neon-db-command:${dbName}`, {
    create: createCommand,
    update: updateCommand,
    delete: deleteCommand,
    environment: {
      NEON_API_KEY: process.env.NEON_API_KEY,
      PROJECT_ID: projectId,
      BRANCH_ID: branchId,
      DATABASE_NAME: dbName,
    },
  })
  return $resolve([result.stdout, dbName]).apply(([stdout, dbName]) => {
    if (stdout.endsWith(`SUCCESS`)) {
      console.log(`Created Neon database ${dbName}`)
      return {
        dbName,
        ownerName,
      }
    } else {
      throw new Error(`Failed to create Neon database ${dbName}: ${stdout}`)
    }
  })
}
