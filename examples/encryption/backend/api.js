import bodyParser from 'body-parser'
import cors from 'cors'
import express from 'express'
import pg from 'pg'

import { z } from 'zod'

// Connect to Postgres.
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:54321/electric'
const DATABASE_USE_SSL = process.env.DATABASE_USE_SSL === 'true' || false
const pool = new pg.Pool({connectionString: DATABASE_URL, ssl: DATABASE_USE_SSL})
const db = await pool.connect()

// Expose an HTTP server.
const PORT = parseInt(process.env.PORT || '3001')
const app = express()
app.use(bodyParser.json())
app.use(cors())

// Validate user input
const createSchema = z.object({
  id: z.string().uuid(),
  ciphertext: z.string(),
  iv: z.string()
})

// Expose `POST {data} /items`.
app.post(`/items`, async (req, res) => {
  let data
  try {
    data = createSchema.parse(req.body)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  // Insert the item into the database.
  const sql = `
    INSERT INTO items (
      id,
      ciphertext,
      iv
    )
    VALUES (
      $1,
      $2,
      $3
    )
  `

  const params = [
    data.id,
    data.ciphertext,
    data.iv
  ]

  try {
    await db.query(sql, params)
  }
  catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`)
})
