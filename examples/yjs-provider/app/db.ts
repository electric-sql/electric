import { Pool } from "pg"

const pool = new Pool({
  host: `localhost`,
  port: 54321,
  password: `password`,
  user: `postgres`,
  database: `electric`,
  max: 1,
})

export { pool }
