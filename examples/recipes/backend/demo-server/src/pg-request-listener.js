const { Pool } = require('pg');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

/**
 * Starts listening to request notifications from Postgres, redirecting
 * them to the appropriate API
 * @param {Pool} pgPool - connection pool to Postgres
 * @param {number} apiPort - the API port
 */
async function startListeningToPgRequests(pgPool, apiPort) {
  const pgClient = await pgPool.connect()
  
  // Listen for PostgreSQL notifications
  await pgClient.query('LISTEN api_trigger');

  // Handle notifications
  pgClient.on('notification', async (notification) => {
    try {
      const payload = JSON.parse(notification.payload);
      console.log(`Received request: ${payload.path} - ${payload.method} - ${payload.data}`);

      let response;
      try {
        // Make an API request using the information from the notification payload
        response = await axios({
          method: payload.method,
          url: `http://localhost:${apiPort}${payload.path}`,
          data: JSON.parse(payload.data),
        });
      } catch (err) {
        response = {
          status: err?.response?.status ?? 500,
          data: { message: err?.message ??  'Failed to process' }
        }
      }

      console.log(`Received response: ${response.status} - ${JSON.stringify(response.data)}`)

      // Insert the API response into the 'responses' table
      const query = 'INSERT INTO responses (id, request_id, status_code, data) VALUES ($1, $2, $3, $4)';
      const values = [uuidv4(), payload.id, response.status, JSON.stringify(response.data)];
      await pgClient.query(query, values);
    } catch (err) {
      console.error('Failed to process PG notification with error:', err);
    }
  });
}

module.exports = {
  startListeningToPgRequests
}
