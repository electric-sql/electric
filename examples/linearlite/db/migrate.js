import connect from '@databases/pg'
import { sql } from '@databases/pg'
import dotenv from 'dotenv'

dotenv.config({
  path: [
    `.env`,
    `./.env.${process.env.NODE_ENV}`,
    `.env.local`,
    `./.env.${process.env.NODE_ENV}.local`,
  ],
})

const filename = `./db/migrations/01-create_tables.sql`

if (!process.env.DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set`)
}

export async function migrate() {
  const db = connect({ connectionString: process.env.DATABASE_URL })
  const file = sql.file(filename)
  try {
    db.query(file)
  } finally {
    db.dispose()
  }
}

await migrate()
