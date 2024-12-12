// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "child_process"

const isProduction = (stage) => stage.toLowerCase() === `production`

export default $config({
  app(input) {
    return {
      name: `tanstack`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      //protect: [`production`].includes(input?.stage),
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: { version: `6.57.0`, region: `eu-west-1` },
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

    const pg = new postgresql.Database(`tanstack`, {}, { provider })

    const pgUri = $interpolate`postgresql://${provider.username}:${provider.password}@${provider.host}/${pg.name}?sslmode=require`
    const electricInfo = pgUri.apply((uri) => {
      return addDatabaseToElectric(uri, `eu-west-1`)
    })

    const domainName = `tanstack${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`

    // We run the backend using AWS Lambda
    const fun = new sst.aws.Function(`TanstackBackend`, {
      handler: `src/server/app.handler`, // uses the `handler` export from the `src/server/app.js` file
      environment: {
        NODE_ENV: `production`,
        DATABASE_URL: pgUri,
      },
      nodejs: {
        install: [`pg`], // exclude `pg` module from the build, instead will install it into node_modules
      },
      url: {
        cors: {
          allowOrigins: [`https://` + domainName],
        },
      },
    })

    const staticSite = new sst.aws.StaticSite(`Tanstack`, {
      environment: {
        VITE_ELECTRIC_URL: process.env.ELECTRIC_API!,
        VITE_ELECTRIC_TOKEN: electricInfo.token,
        VITE_ELECTRIC_DATABASE_ID: electricInfo.id,
        VITE_APP_BACKEND_URL: fun.url,
      },
      build: {
        command: `npm run build`,
        output: `dist`,
      },
      domain: {
        name: domainName,
        dns: sst.cloudflare.dns(),
      },
    })

    pgUri.apply(applyMigrations)

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
  const url = new URL(`/v1/databases`, adminApi)
  const result = await fetch(url, {
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
