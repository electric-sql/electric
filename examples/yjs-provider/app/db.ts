import pgPkg from "pg"
const { Pool } = pgPkg

const connectionString =
  process.env.POOLED_DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`

const pool = new Pool({
  connectionString,
})

export { pool }
