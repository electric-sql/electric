/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { getSharedCluster, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `phoenix-liveview`,
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
    if (!process.env.SECRET_KEY_BASE) {
      throw new Error(`Env variable SECRET_KEY_BASE must be set`)
    }

    if (!process.env.ELECTRIC_API) {
      throw new Error(`ELECTRIC_API environment variable is required`)
    }

    const dbName = isProduction()
      ? `phoenix-liveview-app`
      : `phoenix-liveview-app-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })

    const domainName = `phoenix-liveview${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`

    const cluster = getSharedCluster(`phoenix-liveview-app-${$app.stage}`)
    const service = cluster.addService(
      `phoenix-liveview-app-${$app.stage}-service`,
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
          DATABASE_URL: pooledDatabaseUri,
          ELECTRIC_URL: process.env.ELECTRIC_API,
          SECRET_KEY_BASE: process.env.SECRET_KEY_BASE,
          PHX_HOST: domainName,
          ELECTRIC_SOURCE_ID: sourceId,
          ELECTRIC_SECRET: sourceSecret,
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
