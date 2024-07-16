import type { GlobalSetupContext } from 'vitest/node'
import { FetchError } from '../../client'
import { makePgClient } from './test_helpers'

const url = process.env.ELECTRIC_URL ?? `http://localhost:3000`

// eslint-disable-next-line quotes -- eslint is acting dumb with enforce backtick quotes mode, and is trying to use it here where it's not allowed.
declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string
    testPgSchema: string
  }
}

/**
 * Global setup for the test suite. Validates that our server is running, and creates and tears down a
 * special schema in Postgres to ensure clean slate between runs.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const response = await fetch(url)
  if (!response.ok) throw FetchError.fromResponse(response, url)

  const client = makePgClient()
  await client.connect()
  await client.query(`CREATE SCHEMA IF NOT EXISTS electric_test`)

  provide(`baseUrl`, url)
  provide(`testPgSchema`, `electric_test`)

  return async () => {
    await client.query(`DROP SCHEMA electric_test`)
    await client.end()
  }
}
