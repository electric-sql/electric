/// <reference path="./.sst/platform/config.d.ts" />

import { getSharedCluster, isProduction } from "../.shared/lib/infra"
import { createNeonDb, getNeonConnectionString } from "../.shared/lib/neon"

export default $config({
  app(input) {
    return {
      name: `burn`,
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
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
    if (!process.env.ANTHROPIC_KEY) {
      throw new Error(`ANTHROPIC_KEY environment variable is required`)
    }

    if (!process.env.SECRET_KEY_BASE) {
      throw new Error(`Env variable SECRET_KEY_BASE must be set`)
    }

    const dbName = isProduction() ? `burn-app` : `burn-app-${$app.stage}`

    const { pooledDatabaseUri } = createNeonDatabase({ dbName })

    const domainName = `burn${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`

    const cluster = getSharedCluster(`burn-app-${$app.stage}`)
    const service = cluster.addService(`burn-app-${$app.stage}-service`, {
      loadBalancer: {
        ports: [
          { listen: `443/https`, forward: `4000/http` },
          { listen: `80/http`, forward: `4000/http` },
        ],
        domain: {
          name: domainName,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        ANTHROPIC_KEY: process.env.ANTHROPIC_KEY,
        DATABASE_URL: pooledDatabaseUri,
        PHX_HOST: domainName,
        SECRET_KEY_BASE: process.env.SECRET_KEY_BASE,
      },
      image: {
        context: `.`,
        dockerfile: `Dockerfile`,
      },
    })

    return {
      website: service.url,
    }
  },
})

export function createNeonDatabase({ dbName }: { dbName: string }) {
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

  const res = {
    databaseUri,
    pooledDatabaseUri,
  }

  return res
}
