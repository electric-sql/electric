// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "child_process"

const isProduction = () => $app.stage.toLocaleLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: `yjs`,
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    try {
      const project = neon.getProjectOutput({
        id: process.env.NEON_PROJECT_ID!,
      })

      const dbName = isProduction() ? `yjs` : `yjs-${$app.stage}`

      const { ownerName, dbName: resultingDbName } = createNeonDb({
        projectId: project.id,
        branchId: project.defaultBranchId,
        dbName,
      })

      const pooledUri = getNeonConnectionString({
        project,
        roleName: ownerName,
        databaseName: resultingDbName,
        pooled: true,
      })
      const databaseUri = getNeonConnectionString({
        project,
        roleName: ownerName,
        databaseName: resultingDbName,
        pooled: false,
      })

      databaseUri.apply(applyMigrations)

      const electricInfo = databaseUri.apply((uri) =>
        addDatabaseToElectric(uri)
      )

      // const serverless = deployServerlessApp(electricInfo, pooledUri)
      const website = deployAppServer(electricInfo, databaseUri)

      return {
        // serverless_url: serverless.url,
        server_url: website.url,
        databaseUri,
        databasePooledUri: pooledUri,
      }
    } catch (e) {
      console.error(e)
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

function deployAppServer(
  { id, token }: $util.Output<{ id: string; token: string }>,
  uri: $util.Output<string>
) {
  const vpc = new sst.aws.Vpc(`yjs-vpc-${$app.stage}`, { bastion: true })
  const cluster = new sst.aws.Cluster(`yjs-cluster-${$app.stage}`, { vpc })
  const service = cluster.addService(`yjs-service-${$app.stage}`, {
    loadBalancer: {
      ports: [{ listen: `443/https`, forward: `3000/http` }],
      domain: {
        name: `yjs${isProduction() ? `` : `-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    },
    environment: {
      ELECTRIC_URL: process.env.ELECTRIC_API!,
      DATABASE_URL: uri,
      DATABASE_ID: id,
      ELECTRIC_TOKEN: token,
    },
    image: {
      context: `../..`,
      dockerfile: `Dockerfile`,
    },
    dev: {
      command: `npm run dev`,
    },
  })

  return service
}

// function deployServerlessApp(
//   electricInfo: $util.Output<{ id: string; token: string }>,
//   uri: $util.Output<string>
// ) {
//   return new sst.aws.Nextjs(`yjs`, {
//     environment: {
//       ELECTRIC_URL: process.env.ELECTRIC_API!,
//       ELECTRIC_TOKEN: electricInfo.token,
//       DATABASE_ID: electricInfo.id,
//       NEON_DATABASE_URL: uri,
//     },
//     domain: {
//       name: `yjs${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
//       dns: sst.cloudflare.dns(),
//     },
//   })
// }

async function addDatabaseToElectric(
  uri: string
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  const result = await fetch(`${adminApi}/v1/sources`, {
    method: `PUT`,
    headers: { "Content-Type": `application/json` },
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
