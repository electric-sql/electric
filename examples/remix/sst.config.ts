// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"

const isProduction = (stage: string) => stage.toLowerCase() === `production`

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
        postgresql: `3.14.0`,
      },
    }
  },
  async run() {
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    const dbName = isProduction($app.stage)
      ? `remix-production`
      : `remix-${$app.stage}`
    
    const { sourceId, sourceSecret, pooledDatabaseUri } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
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
        name: `remix${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      pooledDatabaseUri,
      sourceId: sourceId,
      url: staticSite.url,
    }
  },
})
