// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { getExampleSource, isProduction } from "../.shared/lib/infra"

export default $config({
  app(input) {
    return {
      name: `react-app-example`,
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

    const dbName = isProduction() ? `react-app` : `react-app-${$app.stage}`

    const { sourceId, sourceSecret } = getExampleSource(dbName)

    const website = new sst.aws.StaticSite(`react-app-website`, {
      build: {
        command: `npm run build`,
        output: `dist`,
      },
      environment: {
        VITE_ELECTRIC_URL: process.env.ELECTRIC_API,
        VITE_ELECTRIC_SOURCE_SECRET: sourceSecret,
        VITE_ELECTRIC_SOURCE_ID: sourceId,
      },
      domain: {
        name: `react${isProduction() ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
      dev: {
        command: `npm run dev`,
      },
    })

    return {
      website: website.url,
    }
  },
})
