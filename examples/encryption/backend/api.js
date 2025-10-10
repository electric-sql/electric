import bodyParser from 'body-parser'
import cors from 'cors'
import express from 'express'
import pg from 'pg'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

import { z } from 'zod'

// Connect to Postgres.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`
const DATABASE_USE_SSL = process.env.DATABASE_USE_SSL === `true` || false
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_USE_SSL,
})
const db = await pool.connect()

// Expose an HTTP server.
const PORT = parseInt(process.env.PORT || `3001`)
const app = express()
app.use(bodyParser.json())
app.use(cors())

// Validate user input
const createSchema = z.object({
  id: z.string().uuid(),
  ciphertext: z.string(),
  iv: z.string(),
})

// Expose `POST {data} /items`.
app.post(`/items`, async (req, res) => {
  let data
  try {
    data = createSchema.parse(req.body)
  } catch (err) {
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

  const params = [data.id, data.ciphertext, data.iv]

  try {
    await db.query(sql, params)
  } catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: `OK` })
})

// Expose `GET /items` endpoint for syncing encrypted items via Electric
app.get(`/items`, async (req, res) => {
  const ELECTRIC_URL = process.env.ELECTRIC_URL || `http://localhost:3000`
  const electricUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

  // Pass through Electric protocol parameters
  for (const [key, value] of Object.entries(req.query)) {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      electricUrl.searchParams.set(key, value)
    }
  }

  // Set the table - this is handled server-side, not from client
  electricUrl.searchParams.set(`table`, `items`)

  try {
    console.log(`Making request to:`, electricUrl.toString())
    const response = await fetch(electricUrl)
    console.log(
      `Electric response status:`,
      response.status,
      response.statusText
    )

    if (!response.ok) {
      console.error(
        `Electric returned error:`,
        response.status,
        response.statusText
      )
      const errorText = await response.text()
      console.error(`Error body:`, errorText)
      res.writeHead(response.status, { 'Content-Type': `application/json` })
      res.end(JSON.stringify({ error: `Electric error: ${response.status}` }))
      return
    }

    // Copy headers, excluding problematic ones
    const headers = {}
    response.headers.forEach((value, key) => {
      if (
        key.toLowerCase() !== `content-encoding` &&
        key.toLowerCase() !== `content-length`
      ) {
        headers[key] = value
      }
    })

    console.log(`Proxying response with headers:`, Object.keys(headers))

    // Set status and headers
    res.writeHead(response.status, response.statusText, headers)

    // Convert Web Streams to Node.js stream and pipe
    const nodeStream = Readable.fromWeb(response.body)

    // Handle stream errors gracefully
    nodeStream.on(`error`, (err) => {
      console.error(`Stream error:`, err)
      if (!res.headersSent) {
        res.writeHead(500)
      }
      res.end()
    })

    res.on(`close`, () => {
      nodeStream.destroy()
    })

    await pipeline(nodeStream, res)
    console.log(`Successfully completed pipeline`)
  } catch (error) {
    // Ignore premature close errors - these happen when clients disconnect early
    if (error.code === `ERR_STREAM_PREMATURE_CLOSE`) {
      console.log(`Client disconnected early (premature close)`)
      return
    }

    console.error(`Error proxying to Electric:`, error)
    console.error(`Error stack:`, error.stack)
    // Only write headers if they haven't been sent yet
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': `application/json` })
      res.end(
        JSON.stringify({
          error: `Internal server error`,
          details: error.message,
        })
      )
    }
  }
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`)
})
