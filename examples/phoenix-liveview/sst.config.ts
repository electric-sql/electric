/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from "child_process"
import camelcase from "camelcase"

const isProduction = (stage) => stage.toLowerCase() === `production`

const regionName = `eu-west-1`

export default $config({
  app(input) {
    return {
      name: "phoenix-liveview",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
      providers: {
        cloudflare: `5.42.0`,
        aws: { version: `6.57.0`, region: regionName },
        postgresql: `3.14.0`,
      },
    }
  },
  async run() {
    if (!process.env.SECRET_KEY_BASE) {
      throw new Error(
        `Env variable SECRET_KEY_BASE must be set`
      )
    }

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

    const pg = new postgresql.Database(`liveview`, {}, { provider })

    const pgBaseUri = $interpolate`postgresql://${provider.username}:${provider.password}@${provider.host}/${pg.name}`
    const pgUriForElectric = $interpolate`${pgBaseUri}?sslmode=require`
    const electricInfo = pgUriForElectric.apply((uri) => {
      return addDatabaseToElectric(uri, `eu-west-1`)
    })

    const domainName = `phoenix-liveview${isProduction($app.stage) ? `` : `-stage-${$app.stage}`}.examples.electric-sql.com`

    // Run the server on ECS
    const vpcName = camelcase(`electric-region-vpc-2-${regionName}`)
    const vpc = new sst.aws.Vpc(
      vpcName,
      {
        nat: $app.stage === `production` ? `managed` : `ec2`,
      },
      { provider }
    )

    const cluster = new sst.aws.Cluster(
      camelcase(`phoenix-liveview-cluster-${regionName}`),
      { forceUpgrade: `v2`, vpc },
      { provider }
    )

    const liveviewService = cluster.addService(
      camelcase(`phoenix-liveview-service-${regionName}`),
      {
        loadBalancer: {
          public: true,
          domain: {
            name: domainName,
            dns: sst.cloudflare.dns(),
          },
          ports: [
            { listen: `443/https`, forward: `4000/http` },
            { listen: `80/http`, forward: `4000/http` },
          ],
        },
        cpu: `0.25 vCPU`,
        memory: `0.5 GB`,
        // Uncomment the line below if you're trying to deploy from a Mac
        //architecture: `arm64`,
        transform: {
          target: {
            deregistrationDelay: 0,
          },
          service: {
            waitForSteadyState: true,
          },
        },
        environment: {
          DATABASE_URL: $interpolate`${pgBaseUri}?ssl=true`,
          ELECTRIC_URL: `https://api-dev-production.electric-sql.com`,
          SECRET_KEY_BASE: process.env.SECRET_KEY_BASE,
          PHX_HOST: domainName,
          ELECTRIC_CLIENT_PARAMS: $interpolate`{ "database_id": "${electricInfo.id}", "token": "${electricInfo.token}" }`,
        },
        image: {
          context: `.`,
          dockerfile: `Dockerfile`,
        },
      }
    )
    
    pgUriForElectric.apply(applyMigrations)

    return {
      liveview: liveviewService.url,
      databaseId: electricInfo.id,
      token: electricInfo.token,
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
