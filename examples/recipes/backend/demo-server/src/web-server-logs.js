const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const cron = require('cron');
const {
  runOnInterval,
  generateWebServerLog
} = require('./utilities');



/**
 * Starts generating web server logs with variant frequency, also
 * regularly cleans up old logs
 * @param {Pool} pgPool 
 */
function startGeneratingWebServerLogs(pgPool) {
  let numLogsInserted = 0;
  const insertWebServerLog= async () => {
    try {
      const query = 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3) RETURNING *';
      const values = [uuidv4(), new Date().toISOString(), generateWebServerLog()];
      await pgPool.query(query, values);
      numLogsInserted++;
      if (numLogsInserted % 100 == 0) {
        console.log(`Inserted ${numLogsInserted} logs.`);
        numLogsInserted = 0;
      }
      
    } catch (err) {
      if (!err.message.includes('"logs" does not exist')) {
        console.error('Error executing log insertion query:', err.message);
      }
    }
  }

  const cleanUpOldWebServerLogs= async () => {
    try {
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      const query = 'DELETE FROM logs WHERE timestamp < $1';
      const values = [oneHourAgo.toISOString()];
      const result = await pgPool.query(query, values);
      console.log(`Cleaned up ${result.rowCount} old log entries.`);
    } catch (error) {
      console.error('Error executing cleanup query', error);
    }
  }

  // generate logs every 250 +- 200 ms
  runOnInterval(() => insertWebServerLog(), 250, 200);

  // clean up day-old logs every hour
  (new cron.CronJob('0 * * * *', cleanUpOldWebServerLogs)).start();
}

module.exports = {
  startGeneratingWebServerLogs
}