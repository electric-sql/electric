// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `nextjs-example`,
      removal: input?.stage === `production` ? `retain` : `remove`,
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
    const dbName = `nextjs${isProduction() ? `` : `-stage-${$app.stage}`}` 

    const { sourceId, sourceSecret, pooledDatabaseUri } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./db/migrations`,
      })

    const website = new sst.aws.Nextjs(`nextjs`, {
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
        ELECTRIC_SOURCE_ID: sourceId,
        DATABASE_URL: pooledDatabaseUri,
      },
      domain: {
        name: `nextjs${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })
    return {
      website: website.url,
    }
  },
})
