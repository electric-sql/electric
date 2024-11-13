import pgPkg from "pg"
const { Client } = pgPkg

console.log("connecting to DATABASE_URL", process.env.DATABASE_URL)

const db = new Client({
  connectionString: process.env.DATABASE_URL,
})

db.connect()

export { db }
