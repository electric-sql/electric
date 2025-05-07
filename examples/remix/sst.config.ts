// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { getSharedCluster, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `remix`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: { version: `6.57.0`, region: `eu-west-1` },
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    const dbName = isProduction()
      ? `remix-production`
      : `remix-${$app.stage}`
    
    const { sourceId, sourceSecret, pooledDatabaseUri } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })
    
    const websiteDomain = `remix${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`
    
    const cluster = getSharedCluster(`remix-app-${$app.stage}`)
    const service = cluster.addService(`remix-app-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: "443/https", forward: "3010/http" }],
        domain: {
          name: websiteDomain,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        DATABASE_URL: pooledDatabaseUri,
      },
      image: {
        context: "../..",
        dockerfile: "Dockerfile",
      },
    })

    const bucket = new sst.aws.Bucket(`RemixExample`)
    const staticSite = new sst.aws.Remix(`remix`, {
      link: [bucket],
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
        ELECTRIC_SOURCE_ID: sourceId,
        DATABASE_URL: pooledDatabaseUri,
      },
      domain: {
        name: websiteDomain,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      pooledDatabaseUri,
      sourceId: sourceId,
      website: staticSite.url,
      server: service.url,
    }
  },
})
