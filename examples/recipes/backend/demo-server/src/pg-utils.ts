import { type Pool } from 'pg'
import { runOnInterval, wait } from './timing-utils'
import { CronJob } from 'cron'

/**
 * Generates promise that resolves once a connection to the
 * Postgres database specified is possible
 */
export async function waitForPostgresConnection(pgPool: Pool): Promise<void> {
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
export const checkTableExists = async (pgPool: Pool, tableName: string): Promise<boolean> => {
  try {
    const result = await pgPool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = '${tableName}'
      );`,
    )
    return result?.rows[0]?.exists ?? false
  } catch (err) {
    return false
  }
}

/**
 * Resolves once the specified table exists - polls for its
 * existence every [waitIntervalMs] millisecons
 */
export const waitForTable = async (
  pgPool: Pool,
  tableName: string,
  waitIntervalMs: number = 2000,
): Promise<void> => {
  // wait for table to be created before attempting to generate logs
  while (!(await checkTableExists(pgPool, tableName))) {
    console.warn(`Waiting for "${tableName}" table to be created...`)
    await wait(waitIntervalMs)
  }
}

/**
 * Starts generating rows with the specified query and value
 * generator.
 *
 * Can specify the various timings and gneeration frequencies
 */
export async function startGeneratingData({
  pgPool,
  tableName,
  rowGenerationQuery,
  valueGenerator,
  timestampColumn = 'timestamp',
  minutesToRetain = 30,
  rowGenerationFrequencyMs = 250,
  rowGenerationFrequencyVariationMs = 200,
  rowGenerationLoggingFrequencyMs = 60000,
  waitForTableIntervalMs = 3000,
}: {
  pgPool: Pool
  tableName: string
  rowGenerationQuery: string
  valueGenerator: () => Promise<any[]> | any[]
  timestampColumn?: string
  minutesToRetain?: number
  rowGenerationFrequencyMs?: number
  rowGenerationFrequencyVariationMs?: number
  rowGenerationLoggingFrequencyMs?: number
  waitForTableIntervalMs?: number
}): Promise<void> {
  let numRowsInserted = 0
  let lastLoggedTime = Date.now()

  const tag = () => [new Date().toISOString(), tableName].join(' - ')

  const insertRow = async (): Promise<void> => {
    try {
      await pgPool.query(rowGenerationQuery, await Promise.resolve(valueGenerator()))
      numRowsInserted++
      if (Date.now() - lastLoggedTime > rowGenerationLoggingFrequencyMs) {
        console.log(`${tag()} - Inserted ${numRowsInserted} new rows`)
        lastLoggedTime = Date.now()
        numRowsInserted = 0
      }
    } catch (err: any) {
      console.error(`${tag()} - Error executing row insertion query`, err?.message)
    }
  }

  const cleanUpOldRows = async (): Promise<void> => {
    try {
      const thresholdTime = new Date(Date.now() - minutesToRetain * 60 * 1000)
      const query = `DELETE FROM ${tableName} WHERE ${timestampColumn} < $1`
      const values = [thresholdTime.toISOString()]
      const result = await pgPool.query(query, values)
      if ((result.rowCount ?? 0) > 0) {
        console.log(`${tag()} - Cleaned up ${result.rowCount} old rows`)
      }
    } catch (err: any) {
      console.error(`${tag()} - Error executing cleanup query`, err?.message)
    }
  }

  // wait for table to be created before attempting to generate logs
  await waitForTable(pgPool, tableName, waitForTableIntervalMs)

  // generate rows with a given frequency +- a variation
  runOnInterval(
    () => {
      void insertRow()
    },
    rowGenerationFrequencyMs,
    rowGenerationFrequencyVariationMs,
  )

  // try to clean up old rows every 5 minutes
  new CronJob('*/5 * * * *', cleanUpOldRows).start()
}
