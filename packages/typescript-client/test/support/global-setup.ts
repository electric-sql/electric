import type { GlobalSetupContext } from 'vitest/node'
import { makePgClient } from './test-helpers'
import { Client } from 'pg'

const url = process.env.ELECTRIC_URL ?? `http://localhost:3000`
const proxyUrl = process.env.ELECTRIC_PROXY_CACHE_URL ?? `http://localhost:3002`
const databaseId = process.env.DATABASE_ID ?? `test_tenant`
const otherDatabaseId = `other_test_tenant`
const otherDatabaseUrl =
  process.env.OTHER_DATABASE_URL ??
  `postgresql://postgres:password@localhost:54322/electric?sslmode=disable`

// name of proxy cache container to execute commands against,
// see docker-compose.yml that spins it up for details
const proxyCacheContainerName = `electric_dev-nginx-1`
// path pattern for cache files inside proxy cache to clear
const proxyCachePath = `/var/cache/nginx/*`

// eslint-disable-next-line quotes -- eslint is acting dumb with enforce backtick quotes mode, and is trying to use it here where it's not allowed.
declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    proxyCacheBaseUrl: string
    testPgSchema: string
    proxyCacheContainerName: string
    proxyCachePath: string
    databaseId: string
    otherDatabaseId: string
    otherDatabaseUrl: string
  }
}

function waitForElectric(url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(`Timed out waiting for Electric to be active`),
      10000
    )

    const tryHealth = async () =>
      fetch(`${url}/v1/health?database_id=${databaseId}`)
        .then(async (res): Promise<void> => {
          if (!res.ok) return tryHealth()
          const { status } = (await res.json()) as { status: string }
          if (status !== `active`) return tryHealth()
          clearTimeout(timeout)
          resolve()
        })
        .catch((err) => {
          clearTimeout(timeout)
          reject(err)
        })

    return tryHealth()
  })
}

/**
 * Global setup for the test suite. Validates that our server is running, and creates and tears down a
 * special schema in Postgres to ensure clean slate between runs.
 */
export default async function ({ provide }: GlobalSetupContext) {
  await waitForElectric(url)

  const client = makePgClient()
  const otherClient = new Client(otherDatabaseUrl)
  const clients = [client, otherClient]

  for (const c of clients) {
    await c.connect()
    await c.query(`CREATE SCHEMA IF NOT EXISTS electric_test`)
  }

  provide(`baseUrl`, url)
  provide(`testPgSchema`, `electric_test`)
  provide(`proxyCacheBaseUrl`, proxyUrl)
  provide(`proxyCacheContainerName`, proxyCacheContainerName)
  provide(`proxyCachePath`, proxyCachePath)
  provide(`databaseId`, databaseId)
  provide(`otherDatabaseId`, otherDatabaseId)
  provide(`otherDatabaseUrl`, otherDatabaseUrl)

  return async () => {
    for (const c of clients) {
      await c.query(`DROP SCHEMA electric_test CASCADE`)
      await c.end()
    }
  }
}
