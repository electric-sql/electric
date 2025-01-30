// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from "../.shared/database"
import { isProduction } from "../.shared/infra"

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
    const dbName = `nextjs` + isProduction() ? `` : `-stage-${$app.stage}`

    const electricInfo = createDatabaseForCloudElectric({
      dbName,
      migrationsDirectory: `./db/migrations`,
    })

    const website = deployNextJsExample(electricInfo)
    return {
      website: website.url,
    }
  },
})

function deployNextJsExample(electricInfo: {
  sourceId: $util.Output<string>
  sourceSecret: $util.Output<string>
  databaseUri: $util.Output<string>
  pooledDatabaseUri: $util.Output<string>
}) {
  return new sst.aws.Nextjs(`nextjs`, {
    environment: {
      ELECTRIC_URL: process.env.ELECTRIC_API!,
      ELECTRIC_SOURCE_SECRET: electricInfo.sourceSecret,
      ELECTRIC_SOURCE_ID: electricInfo.sourceId,
      DATABASE_URL: electricInfo.pooledDatabaseUri,
    },
    domain: {
      name: `nextjs${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.electric-sql.com`,
      dns: sst.cloudflare.dns(),
    },
  })
}
