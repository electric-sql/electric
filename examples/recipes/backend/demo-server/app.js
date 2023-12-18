const { Pool } = require('pg');
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
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
  let numLogsInserted = 0;
  const insertWebServerLog= async () => {
    try {
      const query = 'INSERT INTO logs(id, timestamp, content) VALUES($1, $2, $3) RETURNING *';
      const values = [uuidv4(), new Date().toISOString(), generateWebServerLog()];
      await pool.query(query, values);
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


const app = express();
const PORT = process.env.DEMO_APP_PORT || 3123;

// Middleware to parse JSON data in the request body
app.use(bodyParser.json());

// Endpoint to handle requests
app.post('/sum', async (req, res) => {
  try {
    const sum = req.body.summands.reduce((acc, value) => acc + value, 0);
    await new Promise((res) => setTimeout(res, 3000));
    res.status(200).json({ sum });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


async function startListeningToPgRequests() {
  const pgClient = await pool.connect()
  // Listen for PostgreSQL notifications
  await pgClient.query('LISTEN api_trigger');

  // Handle notifications
  pgClient.on('notification', async (notification) => {
    const payload = JSON.parse(notification.payload);
    console.log(`Received request: ${payload.path} - ${payload.method} - ${payload.data}`);

    let response = { status: 500, data: { message: 'Failed to process' }}
    try {
      // Make an API request using the information from the notification payload
      response = await axios({
        method: payload.method,
        url: `http://localhost:${PORT}${payload.path}`,
        data: JSON.parse(payload.data),
      });
    } catch (err) {
      response = {
        status: err?.response?.status ?? 500,
        data: { message: err.message }
      }
    }

    console.log(`Received response: ${response.status} - ${JSON.stringify(response.data)}`)

    // Insert the API response into the 'responses' table
    await pool.query({
      text: 'INSERT INTO responses (id, request_id, status_code, data) VALUES ($1, $2, $3, $4)',
      values: [uuidv4(), payload.id, response.status, JSON.stringify(response.data)],
    });
  });
}






function main() {
  // Start the Express server
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
  startGeneratingWebServerLogs();
  startListeningToPgRequests()
}

main();
