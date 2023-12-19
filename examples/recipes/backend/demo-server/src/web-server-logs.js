const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const cron = require('cron');
const { checkTableExists } = require('./pg-utils');
const {
  runOnInterval,
  generateWebServerLog
} = require('./utilities');



/**
 * Starts generating web server logs with variant frequency, also
 * regularly cleans up old logs
 * @param {Pool} pgPool 
 */
async function startGeneratingWebServerLogs(pgPool) {
  const WAIT_INTERVAL_FOR_TABLE_MS = 3000;
  const LOG_GENERATION_FREQUENCY_MS = 250;
  const LOG_GENERATION_FREQUENCY_VARIATION_MS = 200;
  const LOG_GENERATION_LOGGING_INTERVAL_MS = 60000;

  let numLogsInserted = 0;
  let lastLoggedTime = Date.now();

  const insertWebServerLog = async () => {
    try {
      const query = 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3) RETURNING *';
      const values = [uuidv4(), new Date().toISOString(), generateWebServerLog()];
      await pgPool.query(query, values);
      numLogsInserted++;
      if (Date.now() - lastLoggedTime > LOG_GENERATION_LOGGING_INTERVAL_MS) {
        console.log(`${(new Date()).toISOString()} - Inserted ${numLogsInserted} new logs`);
        lastLoggedTime = Date.now();
        numLogsInserted = 0;
      }
    } catch (err) {
      console.error('Error executing log insertion query:', err.message);
    }
  }

  const cleanUpOldWebServerLogs = async () => {
    try {
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      const query = 'DELETE FROM logs WHERE timestamp < $1';
      const values = [oneHourAgo.toISOString()];
      const result = await pgPool.query(query, values);
      console.log(`${(new Date()).toISOString()} - Cleaned up ${result.rowCount} old log entries`);
    } catch (error) {
      console.error('Error executing cleanup query', error);
    }
  }

  // wait for table to be created before attempting to generate logs
  while (!(await checkTableExists(pgPool, 'logs'))) {
    console.warn('Waiting for "logs" table to be created...')
    await new Promise(res => setTimeout(res, WAIT_INTERVAL_FOR_TABLE_MS));
  }

  // generate logs with a given frequency +- a variation
  runOnInterval(
    () => insertWebServerLog(),
    LOG_GENERATION_FREQUENCY_MS,
    LOG_GENERATION_FREQUENCY_VARIATION_MS
  );

  // clean up day-old logs every hour
  (new cron.CronJob('0 * * * *', cleanUpOldWebServerLogs)).start();
}

module.exports = {
  startGeneratingWebServerLogs
}