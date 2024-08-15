import { Pool } from "pg"

console.log(`init pool`)
const pool = new Pool({
  host: `localhost`,
  port: 54321,
  password: `password`,
  user: `postgres`,
  database: `electric`,
  max: 1,
})

export { pool }
