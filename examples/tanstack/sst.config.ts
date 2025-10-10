// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import {
  getExampleSource,
  getSharedCluster,
  isProduction,
} from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `tanstack-app-example`,
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
    if (!process.env.ELECTRIC_API) {
      throw new Error(`ELECTRIC_API environment variable is required`)
    }

    const dbName = isProduction()
      ? `tanstack-app`
      : `tanstack-app-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      getExampleSource(dbName)

    const cluster = getSharedCluster(`tanstack-app-${$app.stage}`)
    const service = cluster.addService(`tanstack-app-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: `443/https`, forward: `3001/http` }],
        domain: {
          name: `tanstack-app-backend${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
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
        command: `npm run dev`,
      },
    })

    const website = new sst.aws.StaticSite(`tanstack-app-website`, {
      build: {
        command: `npm run build`,
        output: `dist`,
      },
      environment: {
        VITE_SERVER_URL: service.url.apply((url) =>
          url.slice(0, url.length - 1)
        ),
      },
      domain: {
        name: `tanstack-app${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
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
