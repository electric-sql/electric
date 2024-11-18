// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { execSync } from 'child_process'

export default $config({
  app(input) {
    return {
      name: `linearlite`,
      removal: input?.stage === `production` ? `retain` : `remove`,
      home: `aws`,
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.57.0`,
        },
        neon: `0.6.3`,
      },
    }
  },
  async run() {
    const project = neon.getProjectOutput({ id: process.env.NEON_PROJECT_ID! })
    const base = {
      projectId: project.id,
      branchId: project.defaultBranchId,
    }

    const db = new neon.Database(`linearlite`, {
      ...base,
      name:
        $app.stage === `Production`
          ? `linearlite-production`
          : `linearlite-${$app.stage}`,
      ownerName: `neondb_owner`,
    })

    const databaseUri = getNeonDbUri(project, db)
    try {
      databaseUri.apply(applyMigrations)
      databaseUri.apply(loadData)

      const electricInfo = databaseUri.apply((uri) =>
        addDatabaseToElectric(uri)
      )

      const website = deployLinearLite(electricInfo)
      return {
        databaseUri,
        database_id: electricInfo.id,
        electric_token: electricInfo.token,
        website: website.url,
      }
    } catch (e) {
      console.error(`Failed to deploy linearlite stack`, e)
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

function loadData(uri: string) {
  execSync(`pnpm run db:load-data`, {
    env: {
      ...process.env,
      DATABASE_URL: uri,
    },
  })
}

function deployLinearLite(
  electricInfo: $util.Output<{ id: string; token: string }>
) {
  return new sst.aws.StaticSite(`linearlite`, {
    environment: {
      VITE_ELECTRIC_URL: process.env.ELECTRIC_API!,
      VITE_ELECTRIC_TOKEN: electricInfo.token,
      VITE_DATABASE_ID: electricInfo.id,
    },
    build: {
      command: `pnpm run --filter @electric-sql/client  --filter @electric-sql/react --filter @electric-examples/linearlite build`,
      output: `dist`,
    },
    domain: {
      name: `linearlite${$app.stage === `production` ? `` : `-stage-${$app.stage}`}.electric-sql.com`,
      dns: sst.cloudflare.dns(),
    },
  })
}

function getNeonDbUri(
  project: $util.Output<neon.GetProjectResult>,
  db: neon.Database
) {
  const passwordOutput = neon.getBranchRolePasswordOutput({
    projectId: project.id,
    branchId: project.defaultBranchId,
    roleName: db.ownerName,
  })

  return $interpolate`postgresql://${passwordOutput.roleName}:${passwordOutput.password}@${project.databaseHost}/${db.name}?sslmode=require`
}

async function addDatabaseToElectric(
  uri: string
): Promise<{ id: string; token: string }> {
  const adminApi = process.env.ELECTRIC_ADMIN_API

  const result = await fetch(`${adminApi}/v1/databases`, {
    method: `PUT`,
    headers: { 'Content-Type': `application/json` },
    body: JSON.stringify({
      database_url: uri,
      region: `us-east-1`,
    }),
  })

  if (!result.ok) {
    throw new Error(
      `Could not add database to Electric (${result.status}): ${await result.text()}`
    )
  }

  return await result.json()
}
