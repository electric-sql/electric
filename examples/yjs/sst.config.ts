// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { getSharedCluster, isProduction } from "../.shared/lib/infra"
import { createDatabaseForCloudElectric } from "../.shared/lib/database"

export default $config({
  app(input) {
    return {
      name: `yjs`,
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      home: `aws`,
      providers: {
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
    const dbName = isProduction() ? `yjs` : `yjs-db-${$app.stage}`

    const { databaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })

    const cluster = getSharedCluster(`yjs-${$app.stage}`)

    const service = cluster.addService(`yjs-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: `443/https`, forward: `3000/http` }],
        domain: {
          name: `yjs${isProduction() ? `` : `-${$app.stage}`}.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        DATABASE_URL: databaseUri,
        ELECTRIC_SOURCE_ID: sourceId,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
      },
      image: {
        context: `../..`,
        dockerfile: `Dockerfile`,
      },
      dev: {
        command: `npm run dev`,
      },
    })

    return {
      website: service.url,
    }
  },
})
