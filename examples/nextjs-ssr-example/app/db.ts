import pgPkg from "pg"
const { Client } = pgPkg

const db = new Client({
  host: `localhost`,
  port: 54321,
  password: `password`,
  user: `postgres`,
  database: `electric`,
})

db.connect()

export { db }
