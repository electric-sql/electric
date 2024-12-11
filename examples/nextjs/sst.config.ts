// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "child_process"

const isProduction = (stage) => stage.toLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: `nextjs-example`,
      removal: isProduction(input?.stage) ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
          region: `eu-west-1`,
        },
        postgresql: "3.14.0",
      },
    }
  },
  async run() {
    if (!process.env.ELECTRIC_API || !process.env.ELECTRIC_ADMIN_API)
      throw new Error(
        `Env variables ELECTRIC_API and ELECTRIC_ADMIN_API must be set`
      )

    if (!process.env.EXAMPLES_DATABASE_HOST || !process.env.EXAMPLES_DATABASE_PASSWORD) {
      throw new Error(
        `Env variables EXAMPLES_DATABASE_HOST and EXAMPLES_DATABASE_PASSWORD must be set`
      )
    }

    try {
      const provider = new postgresql.Provider("neon", {
        host: process.env.EXAMPLES_DATABASE_HOST,
        database: `neondb`,
        username: `neondb_owner`,
        password: process.env.EXAMPLES_DATABASE_PASSWORD,
      })

      const dbName = isProduction($app.stage) ? `nextjs-production` : `nextjs-${$app.stage}`
      const pg = new postgresql.Database(dbName, {}, { provider })

      const pgUri = $interpolate`postgresql://${provider.username}:${provider.password}@${provider.host}/${pg.name}?sslmode=require`
      const electricInfo = pgUri.apply((uri) => {
        return addDatabaseToElectric(uri, `eu-west-1`)
      })

      const website = deployNextJsExample(electricInfo, pgUri)

      pgUri.apply((uri) => applyMigrations(uri))

      return {
        pgUri,
        database_id: electricInfo.id,
        electric_token: electricInfo.token,
        website: website.url,
      }
    } catch (e) {
      console.error(`Failed to deploy nextjs example stack`, e)
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

function deployNextJsExample(
  electricInfo: $util.Output<{ id: string; token: string }>,
  uri: $util.Output<string>
) {
  return new sst.aws.Nextjs(`nextjs`, {
    environment: {
      ELECTRIC_URL: process.env.ELECTRIC_API!,
      ELECTRIC_TOKEN: electricInfo.token,
      DATABASE_ID: electricInfo.id,
      DATABASE_URL: uri,
    },
    domain: {
      name: `nextjs${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
      dns: sst.cloudflare.dns(),
    },
  })
}

async function addDatabaseToElectric(
  uri: string,
  region: `eu-west-1` | `us-east-1`
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API!

  const electricUrl = new URL(`/v1/databases`, adminApi)
  const result = await fetch(electricUrl, {
    method: `PUT`,
    headers: { "Content-Type": `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}
