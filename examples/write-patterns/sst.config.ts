/* eslint-disable quotes */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from 'child_process'

const isProduction = (stage) => stage.toLocaleLowerCase() === 'production'

export default $config({
  app(input) {
    return {
      name: 'write-patterns',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
      providers: {
        cloudflare: '5.42.0',
        aws: {
          version: '6.57.0',
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: '0.6.3',
        command: `1.0.1`,
      },
    }
  },
  async run() {
    const project = neon.getProjectOutput({ id: process.env.NEON_PROJECT_ID! })

    const dbName = isProduction($app.stage)
      ? 'write-patterns-production'
      : `write-patterns-${$app.stage}`

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

    try {
      databaseUri.apply(applyMigrations)

      const electricInfo = databaseUri.apply((uri) =>
        addDatabaseToElectric(uri)
      )

      const vpc = new sst.aws.Vpc(`write-patterns-${$app.stage}-vpc`)
      const cluster = new sst.aws.Cluster(
        `write-patterns-${$app.stage}-cluster`,
        {
          vpc,
        }
      )

      const service = cluster.addService(
        `write-patterns-service-${$app.stage}`,
        {
          loadBalancer: {
            ports: [{ listen: '443/https', forward: '3001/http' }],
            domain: {
              name: `write-patterns-backend${
                $app.stage === 'production' ? '' : `-stage-${$app.stage}`
              }.examples.electric-sql.com`,
              dns: sst.cloudflare.dns(),
            },
          },
          environment: {
            DATABASE_URL: databaseUri,
          },
          image: {
            context: '../..',
            dockerfile: 'Dockerfile',
          },
          dev: {
            command: 'node server.js',
          },
        }
      )

      if (!process.env.ELECTRIC_API) {
        throw new Error('ELECTRIC_API environment variable is required')
      }

      const website = new sst.aws.StaticSite('write-patterns-website', {
        build: {
          command: 'npm run build',
          output: 'dist',
        },
        environment: {
          VITE_SERVER_URL: service.url.apply((url) =>
            url.slice(0, url.length - 1)
          ),
          VITE_ELECTRIC_URL: process.env.ELECTRIC_API,
          VITE_ELECTRIC_DATABASE_ID: electricInfo.id,
          VITE_ELECTRIC_TOKEN: electricInfo.token,
        },
        domain: {
          name: `write-patterns${
            isProduction($app.stage) ? '' : `-stage-${$app.stage}`
          }.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
        dev: {
          command: 'npm run vite',
        },
      })

      return {
        databaseUri,
        database_id: electricInfo.id,
        electric_token: electricInfo.token,
        server: service.url,
        website: website.url,
      }
    } catch (e) {
      console.error('Failed to deploy todo app example stack', e)
    }
  },
})

function applyMigrations(uri: string) {
  execSync('pnpm exec pg-migrations apply --directory ./shared/migrations', {
    env: {
      ...process.env,
      DATABASE_URL: uri,
    },
  })
}

async function addDatabaseToElectric(
  database_url: string,
  region: 'us-east-1' | 'eu-west-1' = 'us-east-1'
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  const result = await fetch(new URL('v1/sources', adminApi), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      database_url,
      region,
      team_id: teamId,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${
        result.status
      }): ${await result.text()}`
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
