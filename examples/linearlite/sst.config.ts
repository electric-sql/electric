// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from 'child_process'

const isProduction = (stage: string) =>
  stage.toLocaleLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: `linearlite`,
      removal: isProduction(input?.stage) ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
        },
      },
    }
  },
  async run() {
    try {
      const databaseUri = $interpolate`postgresql://postgres:${process.env.LINEARLITE_SUPABASE_PROJECT_PASSWORD}@db.${process.env.LINEARLITE_SUPABASE_PROJECT_ID}.supabase.co:5432/postgres`

      databaseUri.apply(applyMigrations)

      const electricInfo = databaseUri.apply((uri) =>
        addDatabaseToElectric(uri)
      )

      if (!process.env.ELECTRIC_API) {
        throw new Error(`ELECTRIC_API environment variable is required`)
      }

      const website = new sst.aws.StaticSite('linearlite-website', {
        build: {
          command: 'npm run build',
          output: 'dist',
        },
        environment: {
          VITE_ELECTRIC_URL: process.env.ELECTRIC_API,
          VITE_ELECTRIC_TOKEN: electricInfo.token,
          VITE_ELECTRIC_DATABASE_ID: electricInfo.id,
        },
        domain: {
          name: `linearlite${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
        dev: {
          command: 'npm run vite',
        },
      })

      return {
        databaseUri,
        database_id: electricInfo.id,
        electric_token: electricInfo.token,
        website: website.url,
      }
    } catch (e) {
      console.error(`Failed to deploy todo app ${$app.stage} stack`, e)
    }
  },
})

function applyMigrations(uri: string) {
  execSync(`pnpm exec pg-migrations apply --directory ./db/migrations`, {
    env: {
      ...process.env,
      DATABASE_URL: uri,
    },
  })
}

async function addDatabaseToElectric(
  uri: string
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID

  const result = await fetch(`${adminApi}/v1/sources`, {
    method: `PUT`,
    headers: { 'Content-Type': `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region: `us-east-1`,
      team_id: teamId,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}
