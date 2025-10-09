/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/lib/database"
import { isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `proxy-auth`,
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          region: `eu-west-1`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        postgresql: `3.14.0`,
        neon: `0.6.3`,
        command: `1.0.1`,
      },
    }
  },
  async run() {
    if (!process.env.ELECTRIC_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    const dbName = isProduction()
      ? `proxy-auth-production`
      : `proxy-auth-${$app.stage}`

    const { sourceId, sourceSecret } = createDatabaseForCloudElectric({
      dbName,
      migrationsDirectory: `./db/migrations`,
    })

    const staticSite = new sst.aws.Nextjs(`proxy-auth`, {
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
        ELECTRIC_SOURCE_ID: sourceId,
      },
      domain: {
        name: `proxy-auth${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      website: staticSite.url,
    }
  },
})
