import { type Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { CronJob } from 'cron'
import { checkTableExists } from './pg-utils'
import { generateWebServerLog } from './generation-utils'
import { runOnInterval, wait } from './timing-utils'

/**
 * Starts generating web server logs with variant frequency, also
 * regularly cleans up old logs
 */
export async function startGeneratingWebServerLogs (pgPool: Pool): Promise<void> {
  const WAIT_INTERVAL_FOR_TABLE_MS = 3000
  const LOG_GENERATION_FREQUENCY_MS = 250
  const LOG_GENERATION_FREQUENCY_VARIATION_MS = 200
  const LOG_GENERATION_LOGGING_INTERVAL_MS = 60000

  let numLogsInserted = 0
  let lastLoggedTime = Date.now()

  const insertWebServerLog = async (): Promise<void> => {
    try {
      const query = 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3) RETURNING *'
      const values = [uuidv4(), new Date().toISOString(), generateWebServerLog()]
      await pgPool.query(query, values)
      numLogsInserted++
      if (Date.now() - lastLoggedTime > LOG_GENERATION_LOGGING_INTERVAL_MS) {
        console.log(`${(new Date()).toISOString()} - Inserted ${numLogsInserted} new logs`)
        lastLoggedTime = Date.now()
        numLogsInserted = 0
      }
    } catch (err: any) {
      console.error('Error executing log insertion query:', err?.message)
    }
  }

  const cleanUpOldWebServerLogs = async (): Promise<void> => {
    try {
      const oneHourAgo = new Date()
      oneHourAgo.setHours(oneHourAgo.getHours() - 1)
      const query = 'DELETE FROM logs WHERE timestamp < $1'
      const values = [oneHourAgo.toISOString()]
      const result = await pgPool.query(query, values)
      console.log(`${(new Date()).toISOString()} - Cleaned up ${result.rowCount} old log entries`)
    } catch (error) {
      console.error('Error executing cleanup query', error)
    }
  }

  // wait for table to be created before attempting to generate logs
  while (!(await checkTableExists(pgPool, 'logs'))) {
    console.warn('Waiting for "logs" table to be created...')
    await wait(WAIT_INTERVAL_FOR_TABLE_MS);
  }

  // generate logs with a given frequency +- a variation
  runOnInterval(
    () => {
      void insertWebServerLog()
    },
    LOG_GENERATION_FREQUENCY_MS,
    LOG_GENERATION_FREQUENCY_VARIATION_MS
  );

  // clean up day-old logs every hour
  (new CronJob('0 * * * *', cleanUpOldWebServerLogs)).start()
}
