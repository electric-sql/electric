const createPool = require('@databases/pg');
const {sql} = require('@databases/pg');

const db = createPool('postgresql://postgres:password@localhost:5432/electric');

db.query(sql.file('./db/migrations.sql')).catch(ex => {
  console.error(ex);
  process.exitCode = 1;
}).then(() => db.dispose());