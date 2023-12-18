const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const cron = require('cron');
const {
  runOnInterval,
  generateWebServerLog
} = require('./utilities');


const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});


function startGeneratingWebServerLogs() {
  const insertWebServerLog= async () => {
    try {
      const query = 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3) RETURNING *';
      const values = [uuidv4(), new Date().toISOString(), generateWebServerLog()];
      const result = await pool.query(query, values);
      console.log('Inserted log:', Object.values(result.rows[0]).join(' - '));
    } catch (err) {
      console.error('Error executing log insertion query:', err);
    }
  }

  const cleanUpOldWebServerLogs= async () => {
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const query = 'DELETE FROM logs WHERE timestamp < $1';
      const values = [oneDayAgo.toISOString()];
      const result = await pool.query(query, values);
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


function main() {
  startGeneratingWebServerLogs();
}

main();
