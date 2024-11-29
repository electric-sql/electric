import pgPkg from "pg"
const { Pool } = pgPkg

console.log(`POOLED_DATABASE_URL: ${process.env.POOLED_DATABASE_URL}`)

const pool = new Pool({
  connectionString: process.env.POOLED_DATABASE_URL,
})

export { pool }
