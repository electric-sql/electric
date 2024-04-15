import createPool, { sql } from '@databases/pg'

const DATABASE_URL =
  process.env.ELECTRIC_DATABASE_URL || process.env.DATABASE_URL

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

console.info('Deleting all in tables..')
await db.query(sql`
  BEGIN;
    DELETE FROM comment;
    DELETE FROM issue;
  COMMIT;
`)

db.dispose()
console.info('Done.')
