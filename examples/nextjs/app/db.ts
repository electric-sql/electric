import pgPkg from "pg"
const { Client } = pgPkg

const db = new Client({
  connectionString: process.env.DATABASE_URL,
})

db.connect()

export { db }
