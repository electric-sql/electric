/// <reference path="./.sst/platform/config.d.ts" />
import { execSync } from "child_process"

const isProduction = (stage) => stage.toLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: "basic-example",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        cloudflare: `5.42.0`,
        aws: { version: `6.57.0`, region: `eu-west-1` },
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

    const provider = new postgresql.Provider("neon", {
      host: process.env.EXAMPLES_DATABASE_HOST,
      database: `neondb`,
      username: `neondb_owner`,
      password: process.env.EXAMPLES_DATABASE_PASSWORD,
    })

    const pg = new postgresql.Database("basic_example", {}, { provider })

    const pgUri = $interpolate`postgresql://${provider.username}:${provider.password}@${provider.host}/${pg.name}?sslmode=require`
    const electricInfo = pgUri.apply((uri) => {
      applyMigrations(uri)
      return addDatabaseToElectric(uri, `eu-west-1`)
    })
    const staticSite = new sst.aws.StaticSite("BasicExampleWeb", {
      environment: {
        VITE_ELECTRIC_URL: process.env.ELECTRIC_API!,
        VITE_ELECTRIC_TOKEN: electricInfo.token,
        VITE_ELECTRIC_DATABASE_ID: electricInfo.id,
      },
      build: {
        command: "npm run build",
        output: "dist",
      },
      domain: {
        name: `basic${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
    })
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
  const result = await fetch(`${adminApi}/v1/databases`, {
    method: `PUT`,
    headers: { "Content-Type": `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region,
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
