/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { getSharedCluster, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `todo-app-example`,
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
    const dbName = isProduction() ? `todo-app` : `todo-app-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })

    if (!process.env.ELECTRIC_API) {
      throw new Error(`ELECTRIC_API environment variable is required`)
    }

    const cluster = getSharedCluster(`todo-app-${$app.stage}`)
    const service = cluster.addService(`todo-app-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: `443/https`, forward: `3010/http` }],
        health: {
          "3010/http": {
            path: `/health`,
          },
        },
        domain: {
          name: `todo-app-backend${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        DATABASE_URL: pooledDatabaseUri,
        ELECTRIC_URL: process.env.ELECTRIC_API,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
        ELECTRIC_SOURCE_ID: sourceId,
      },
      image: {
        context: `../..`,
        dockerfile: `Dockerfile`,
      },
      dev: {
        command: `node server.js`,
      },
    })

    const website = new sst.aws.StaticSite(`todo-app-website`, {
      build: {
        command: `npm run build`,
        output: `dist`,
      },
      environment: {
        VITE_SERVER_URL: service.url.apply((url) =>
          url.slice(0, url.length - 1)
        ),
        VITE_ELECTRIC_URL: process.env.ELECTRIC_API,
      },
      domain: {
        name: `todo-app${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
      dev: {
        command: `npm run vite`,
      },
    })

    return {
      server: service.url,
      website: website.url,
    }
  },
})
