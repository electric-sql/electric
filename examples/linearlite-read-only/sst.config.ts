/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from 'child_process'
import { createDatabaseForCloudElectric } from '../.shared/lib/database'
import { isProduction } from '../.shared/lib/infra'

export default $config({
  app(input) {
    return {
      name: `linearlite-read-only`,
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
    try {
      // Neon DB names must be valid identifiers (letters, digits, underscores)
      const rawName = `linearlite_read_only${
        isProduction() ? `` : `_stage_${$app.stage}`
      }`
      const dbName = rawName.replace(/[^a-zA-Z0-9_]/g, `_`).toLowerCase()

      console.log(`Preparing Neon database`, { stage: $app.stage, dbName })

      const { pooledDatabaseUri, sourceId, sourceSecret } =
        createDatabaseForCloudElectric({
          dbName,
          migrationsDirectory: `./db/migrations`,
        })

      pooledDatabaseUri.apply(loadData)

      const website = new sst.aws.StaticSite(`linearlite-read-only`, {
        environment: {
          VITE_ELECTRIC_URL: process.env.ELECTRIC_API!,
          VITE_ELECTRIC_SOURCE_SECRET: sourceSecret,
          VITE_ELECTRIC_SOURCE_ID: sourceId,
        },
        build: {
          command: `pnpm run --filter @electric-sql/client  --filter @electric-sql/react --filter @electric-examples/linearlite-read-only build`,
          output: `dist`,
        },
        domain: {
          name: `linearlite-read-only${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
      })

      return {
        website: website.url,
      }
    } catch (error) {
      console.error(`Failed to deploy linearlite-read-only`, {
        stage: $app.stage,
        message: (error as Error)?.message,
      })
      throw error
    }
  },
})

function loadData(uri: string) {
  execSync(`pnpm run db:load-data`, {
    env: {
      ...process.env,
      DATABASE_URL: uri,
    },
  })
}
