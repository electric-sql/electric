/* eslint-disable quotes */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./.sst/platform/config.d.ts" />

import { createDatabaseForCloudElectric } from '../.shared/lib/database'
import { getSharedCluster, isProduction } from '../.shared/lib/infra'

export default $config({
  app(input) {
    return {
      name: 'write-patterns',
      removal:
        input?.stage.toLocaleLowerCase() === `production` ? `retain` : `remove`,
      home: 'aws',
      providers: {
        cloudflare: `5.42.0`,
        aws: {
          version: `6.66.2`,
          profile: process.env.CI ? undefined : `marketing`,
        },
        neon: '0.6.3',
        command: `1.0.1`,
      },
    }
  },
  async run() {
    const dbName = isProduction()
      ? 'write-patterns-production'
      : `write-patterns-${$app.stage}`

    const { pooledDatabaseUri, sourceId, sourceSecret } =
      createDatabaseForCloudElectric({
        dbName,
        migrationsDirectory: `./shared/migrations`,
      })

    if (!process.env.ELECTRIC_API) {
      throw new Error('ELECTRIC_API environment variable is required')
    }

    const cluster = getSharedCluster(`write-patterns-${$app.stage}`)

    const service = cluster.addService(`write-patterns-${$app.stage}-service`, {
      loadBalancer: {
        ports: [{ listen: '443/https', forward: '3001/http' }],
        health: {
          '3001/http': {
            path: '/health',
          },
        },
        domain: {
          name: `write-patterns-backend${
            isProduction() ? '' : `-stage-${$app.stage}`
          }.examples.electric-sql.com`,
          dns: sst.cloudflare.dns(),
        },
      },
      environment: {
        DATABASE_URL: pooledDatabaseUri,
        ELECTRIC_URL: process.env.ELECTRIC_API,
        ELECTRIC_SOURCE_ID: sourceId,
        ELECTRIC_SOURCE_SECRET: sourceSecret,
      },
      image: {
        context: '../..',
        dockerfile: 'Dockerfile',
      },
      dev: {
        command: 'node server.js',
      },
    })

    const website = new sst.aws.StaticSite('write-patterns-website', {
      build: {
        command: 'npm run build',
        output: 'dist',
      },
      environment: {
        VITE_SERVER_URL: service.url.apply((url) =>
          url.slice(0, url.length - 1)
        ),
      },
      domain: {
        name: `write-patterns${
          isProduction() ? '' : `-stage-${$app.stage}`
        }.examples.electric-sql.com`,
        dns: sst.cloudflare.dns(),
      },
      dev: {
        command: 'npm run vite',
      },
    })

    return {
      server: service.url,
      website: website.url,
    }
  },
})
