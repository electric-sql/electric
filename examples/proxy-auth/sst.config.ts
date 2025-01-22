// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />
import { execSync } from "child_process"

const isProduction = (stage: string) => stage.toLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: `proxy-auth`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
          region: `eu-west-1`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        postgresql: `3.14.0`,
      },
    }
  },
  async run() {
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    if (
      !process.env.EXAMPLES_DATABASE_HOST ||
      !process.env.EXAMPLES_DATABASE_PASSWORD
    ) {
      throw new Error(
        `Env variables EXAMPLES_DATABASE_HOST and EXAMPLES_DATABASE_PASSWORD must be set`
      )
    }

    const provider = new postgresql.Provider(`neon`, {
      host: process.env.EXAMPLES_DATABASE_HOST,
      database: `neondb`,
      username: `neondb_owner`,
      password: process.env.EXAMPLES_DATABASE_PASSWORD,
    })

    const dbName = isProduction($app.stage)
      ? `proxy-auth-production`
      : `proxy-auth-${$app.stage}`
    const pg = new postgresql.Database(dbName, {}, { provider })

    const pgUri = $interpolate`postgresql://${provider.username}:${provider.password}@${provider.host}/${pg.name}?sslmode=require`
    const electricInfo = pgUri.apply((uri) => {
      return addDatabaseToElectric(uri, `eu-west-1`)
    })

    const staticSite = new sst.aws.Nextjs(`proxy-auth`, {
      environment: {
        ELECTRIC_URL: process.env.ELECTRIC_API!,
        ELECTRIC_TOKEN: electricInfo.token,
        DATABASE_ID: electricInfo.id,
      },
      domain: {
        name: `proxy-auth${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })

    pgUri.apply((uri) => applyMigrations(uri))

    return {
      pgUri,
      databaseId: electricInfo.id,
      token: electricInfo.token,
      url: staticSite.url,
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
  uri: string,
  region: string
): Promise<{
  id: string
  token: string
}> {
  const adminApi = process.env.ELECTRIC_ADMIN_API
  const teamId = process.env.ELECTRIC_TEAM_ID
  const url = new URL(`/v1/sources`, adminApi)
  const result = await fetch(url, {
    method: `PUT`,
    headers: { "Content-Type": `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region,
      team_id: teamId,
    }),
  })
  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${
        result.status
      }): ${await result.text()}`
    )
  }
  return (await result.json()) as {
    token: string
    id: string
  }
}
