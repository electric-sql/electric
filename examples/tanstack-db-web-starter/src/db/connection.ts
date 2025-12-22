import "@dotenvx/dotenvx/config"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(`DATABASE_URL is not set`)
}
const pool = new Pool({ connectionString: databaseUrl })
export const db = drizzle({ client: pool, casing: `snake_case` })
