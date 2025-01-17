import pgPkg from "pg"
const { Client } = pgPkg

const db = new Client({
  connectionString:
    process.env.DATABASE_URL ||
    `postgresql://postgres:password@localhost:54321/electric`,
})

db.connect()

export { db }
