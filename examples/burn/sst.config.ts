/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { getSharedCluster, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: "burn",
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      home: "aws",
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

    const dbName = isProduction()
      ? `burn-app`
      : `burn-app-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({ dbName })

    const domainName = `burn${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`

    const cluster = getSharedCluster(`burn-app-${$app.stage}`)
    const service = cluster.addService(
      `burn-app-${$app.stage}-service`,
      {
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
      }
    )

    return {
      website: service.url,
    }
  },
})
