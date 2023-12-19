const { Pool } = require('pg');

/**
 * Generates promise that resolves once a connection to the
 * Postgres database specified is possible
 * @param {Pool} pgPool 
 */
async function waitForPostgresConnection(pgPool) {
  let connected = false;
  while (!connected) {
    try {
      const pgClient = await pgPool.connect();
      connected = true;
      console.log('PostgreSQL connection established.');
      await pgClient.end();
    } catch (error) {
      console.error('Error connecting to PostgreSQL:', error.message);
      console.log('Retrying in 5 seconds...');
      await new Promise(res => setTimeout(res, 5000)); 
    }
  }
}

/**
 * Checks whether a the given [tableName] exists on the
 * database specified by [pgPool]
 * @param {Pool} pgPool 
 * @param {string} tableName 
 * @returns 
 */
const checkTableExists = async (pgPool, tableName) => {
  try {
    const result = await pgPool.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = '${tableName}'
      );`
    );
    return result?.rows[0]?.exists ?? false;
  } catch (err) {
    return false;
  }
};

module.exports = {
  waitForPostgresConnection,
  checkTableExists
}