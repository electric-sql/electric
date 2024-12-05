// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "child_process"

export default $config({
  app(input) {
    return {
      name: `yjs`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
        },
        neon: `0.6.3`,
      },
    }
  },
  async run() {
    const project = neon.getProjectOutput({ id: process.env.NEON_PROJECT_ID! })
    const base = {
      projectId: project.id,
      branchId: project.defaultBranchId,
    }

    const db = new neon.Database(`yjs`, {
      ...base,
      ownerName: `neondb_owner`,
      name:
        $app.stage === `Production` ? `yjs-production` : `yjs-${$app.stage}`,
    })

    // const vpc = new sst.aws.Vpc(`yjs-vpc-${$app.stage}`, { bastion: true })

    // const rds = new sst.aws.Postgres(`yjs-${$app.stage}Database`, {
    //   vpc,
    //   // proxy: true,
    //   transform: {
    //     instance: {
    //       publiclyAccessible: true,
    //     },
    //   },
    // })
    // const databaseUri = getRdsDbUri(rds)

    const databaseUri = getNeonDbUri(project, db, false)
    const databasePooledUri = getNeonDbUri(project, db, true)
    try {
      databaseUri.apply(applyMigrations)

      const electricInfo = databaseUri.apply((uri) =>
        addDatabaseToElectric(uri)
      )

      const website = deployServerlessApp(
        electricInfo,
        databaseUri,
        databasePooledUri
      )
      return { url: website.url, databaseUri, databasePooledUri }
    } catch (e) {}
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

// function deployApp(
//   { id, token }: $util.Output<{ id: string; token: string }>,
//   uri: $util.Output<string>,
//   vpc: sst.aws.Vpc
// ) {
//   const cluster = new sst.aws.Cluster(`yjs-cluster-${$app.stage}`, { vpc })

//   const service = cluster.addService(`yjs-service-${$app.stage}`, {
//     loadBalancer: {
//       ports: [{ listen: "443/https", forward: "3000/http" }],
//       domain: {
//         name: `yjs-server-${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.electric-sql.com`,
//         dns: sst.cloudflare.dns(),
//       },
//     },
//     environment: {
//       ELECTRIC_URL: process.env.ELECTRIC_API!,
//       DATABASE_URL: uri,
//       DATABASE_ID: id,
//       ELECTRIC_TOKEN: token,
//     },
//     image: {
//       context: "../..",
//       dockerfile: "Dockerfile",
//     },
//     dev: {
//       command: "npm run dev",
//     },
//   })

//   return service
// }

function deployServerlessApp(
  electricInfo: $util.Output<{ id: string; token: string }>,
  uri: $util.Output<string>,
  pooledUri: $util.Output<string>
) {
  return new sst.aws.Nextjs(`yjs`, {
    environment: {
      ELECTRIC_URL: process.env.ELECTRIC_API!,
      ELECTRIC_TOKEN: electricInfo.token,
      DATABASE_ID: electricInfo.id,
      DATABASE_URL: uri,
      POOLED_DATABASE_URL: pooledUri,
    },
    domain: {
      name: `yjs${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.electric-sql.com`,
      dns: sst.cloudflare.dns(),
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
          endpoints![0].id + "-pooled"
        )
      )
    : project.databaseHost

  const url = $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${databaseHost}/${db.name}?sslmode=require`
  return url
}

async function addDatabaseToElectric(
  uri: string
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API

  const result = await fetch(`${adminApi}/v1/databases`, {
    method: `PUT`,
    headers: { "Content-Type": `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region: `us-east-1`,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}
