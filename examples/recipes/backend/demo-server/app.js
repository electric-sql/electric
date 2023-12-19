const { Pool } = require('pg');
const { startGeneratingWebServerLogs } = require('./src/web-server-logs');
const { startListeningToPgRequests } = require('./src/pg-request-listener');
const { setupApi } = require('./src/api-setup');
const { waitForPostgresConnection } = require('./src/pg-utils');

const API_PORT = process.env.DEMO_APP_PORT || 3123;
const pgPool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});


async function main() {
  setupApi(API_PORT)

  await waitForPostgresConnection(pgPool)
  startListeningToPgRequests(pgPool, API_PORT)
  startGeneratingWebServerLogs(pgPool);
}

main();
