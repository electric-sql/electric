// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { getExampleSource, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `remix`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
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
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    const dbName = isProduction() ? `remix-production` : `remix-${$app.stage}`

    const { sourceId, sourceSecret, pooledDatabaseUri } =
      getExampleSource(dbName)

    const bucket = new sst.aws.Bucket(`RemixExample`, {
      access: `public`,
    })

    const remix = new sst.aws.Remix(`remix-${$app.stage}`, {
      link: [bucket],
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
        ELECTRIC_SOURCE_ID: sourceId,
        DATABASE_URL: pooledDatabaseUri,
      },
      domain: {
        name: `remix${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    return {
      pooledDatabaseUri,
      sourceId: sourceId,
      website: remix.url,
    }
  },
})
