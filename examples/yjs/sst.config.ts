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
    const dbName = isProduction() ? `yjs` : `yjs-db-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })

    const cluster = getSharedCluster(`yjs-${$app.stage}`)

    const service = cluster.addService(`yjs-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: `443/https`, forward: `3002/http` }],
        health: {
          "3002/http": {
            path: `/health`,
          },
        },
        domain: {
          name: `yjs-server${isProduction() ? `` : `-${$app.stage}`}.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        DATABASE_URL: pooledDatabaseUri,
        ELECTRIC_SOURCE_ID: sourceId,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
      },
      image: {
        context: `../..`,
        dockerfile: `Dockerfile`,
      },
      dev: {
        command: `npm run dev:server`,
      },
    })

    const website = new sst.aws.StaticSite(`yjs-website`, {
      build: {
        command: `pnpm run --filter @electric-sql/client  --filter @electric-sql/react --filter @electric-sql/y-electric --filter @electric-examples/yjs build`,
        output: `dist/client`,
      },
      environment: {
        VITE_SERVER_URL: service.url,
      },
      domain: {
        name: `yjs${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
      dev: {
        command: `npm run vite`,
      },
    })

    return {
      website: website.url,
      server: service.url,
    }
  },
})
