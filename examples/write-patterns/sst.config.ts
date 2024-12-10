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
        },
        neon: '0.6.3',
      },
    }
  },
  async run() {
    const project = neon.getProjectOutput({ id: process.env.NEON_PROJECT_ID! })
    const base = {
      projectId: project.id,
      branchId: project.defaultBranchId,
    }

    const db = new neon.Database('write-patterns', {
      ...base,
      name: isProduction($app.stage)
        ? 'write-patterns-production'
        : `write-patterns-${$app.stage}`,
      ownerName: 'neondb_owner',
    })

    const databaseUri = getNeonDbUri(project, db, false)
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

function getNeonDbUri(
  project: $util.Output<neon.GetProjectResult>,
  db: neon.Database,
  pooled: boolean
) {
  const passwordOutput = neon.getBranchRolePasswordOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
    roleName: db.ownerName,
  })

  const endpoint = neon.getBranchEndpointsOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
  })

  const databaseHost = pooled
    ? endpoint.endpoints?.apply((endpoints) =>
        endpoints![0].host.replace(
          endpoints![0].id,
          endpoints![0].id + '-pooler'
        )
      )
    : project.databaseHost

  const url = $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${databaseHost}/${db.name}?sslmode=require`
  return url
}

async function addDatabaseToElectric(
  database_url: string,
  region: 'us-east-1' | 'eu-west-1' = 'us-east-1'
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API

  const result = await fetch(new URL('v1/databases', adminApi), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      database_url,
      region,
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
