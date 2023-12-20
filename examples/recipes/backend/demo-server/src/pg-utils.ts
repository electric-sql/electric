import { type Pool } from 'pg'
import { wait } from './timing-utils'

/**
 * Generates promise that resolves once a connection to the
 * Postgres database specified is possible
 */
export async function waitForPostgresConnection (pgPool: Pool): Promise<void> {
  let connected = false
  while (!connected) {
    try {
      const pgClient = await pgPool.connect()
      connected = true
      console.log('PostgreSQL connection established.')
      pgClient.release()
    } catch (error: any) {
      console.error('Error connecting to PostgreSQL:', error.message)
      console.log('Retrying in 5 seconds...')
      await wait(5000)
    }
  }
}

/**
 * Checks whether a the given tableName exists on the
 * database specified by pgPool
 */
export const checkTableExists = async (
  pgPool: Pool,
  tableName: string
): Promise<boolean> => {
  try {
    const result = await pgPool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = '${tableName}'
      );`
    )
    return result?.rows[0]?.exists ?? false
  } catch (err) {
    return false
  }
}
