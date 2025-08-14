import bodyParser from 'body-parser'
import cors from 'cors'
import express from 'express'
import pg from 'pg'

import { z } from 'zod'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

// Connect to Postgres.
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:password@localhost:54321/electric'
const pool = new pg.Pool({ connectionString: DATABASE_URL })

// Expose an HTTP server.
const PORT = parseInt(process.env.PORT || '3001')
const app = express()
app.use(bodyParser.json())
app.use(cors())

// Validate user input
const idSchema = z.string().uuid()
const createSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  write_id: z.string().optional(),
})
const updateSchema = z.object({
  completed: z.boolean(),
  write_id: z.string().optional(),
})

// Define functions to create, update and delete todos
// using the `db` client.

const createTodo = async (id, title, created_at, write_id) => {
  const sql = `
    INSERT INTO todos (id, title, completed, created_at, write_id)
    VALUES ($1, $2, false, $3, $4)
  `

  const params = [id, title, created_at, write_id || null]

  await pool.query(sql, params)
}

const updateTodo = async (id, completed, write_id) => {
  const sql = `
    UPDATE todos SET completed = $1, write_id = $2
    WHERE id = $3
  `

  const params = [completed ? '1' : '0', write_id || null, id]

  await pool.query(sql, params)
}

const deleteTodo = async (id) => {
  const sql = 'DELETE from todos where id = $1'
  const params = [id]
  await pool.query(sql, params)
}

// Expose the shared REST API to create, update and delete todos.

// GET /todos - proxy to Electric for syncing todos
app.get('/todos', async (req, res) => {
  const ELECTRIC_URL = process.env.ELECTRIC_URL || 'http://localhost:3000'
  const electricUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

  // Only pass through Electric protocol parameters
  Object.keys(req.query).forEach((key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      electricUrl.searchParams.set(key, req.query[key])
    }
  })

  // Set the table server-side
  electricUrl.searchParams.set('table', 'todos')

  // Add source credentials if available
  if (process.env.ELECTRIC_SOURCE_ID) {
    electricUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
  }
  if (process.env.ELECTRIC_SOURCE_SECRET) {
    electricUrl.searchParams.set('secret', process.env.ELECTRIC_SOURCE_SECRET)
  }

  try {
    const response = await fetch(electricUrl)

    // Remove problematic headers that could break decoding
    const headers = {}
    response.headers.forEach((value, key) => {
      if (
        key.toLowerCase() !== 'content-encoding' &&
        key.toLowerCase() !== 'content-length'
      ) {
        headers[key] = value
      }
    })

    // Set status and headers
    res.writeHead(response.status, response.statusText, headers)

    // Convert Web Streams to Node.js stream and pipe
    const nodeStream = Readable.fromWeb(response.body)

    // Handle stream errors gracefully
    nodeStream.on('error', (err) => {
      console.error('Stream error:', err)
      if (!res.headersSent) {
        res.writeHead(500)
      }
      res.end()
    })

    res.on('close', () => {
      nodeStream.destroy()
    })

    await pipeline(nodeStream, res)
  } catch (error) {
    // Ignore premature close errors - these happen when clients disconnect early
    if (error.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      return
    }

    console.error('Error proxying to Electric:', error)
    // Only write headers if they haven't been sent yet
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
})

app.post('/todos', async (req, res) => {
  let data
  try {
    data = createSchema.parse(req.body)
  } catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await createTodo(data.id, data.title, data.created_at, data.write_id)
  } catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

app.put('/todos/:id', async (req, res) => {
  let id, data
  try {
    id = idSchema.parse(req.params.id)
    data = updateSchema.parse(req.body)
  } catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await updateTodo(id, data.completed, data.write_id)
  } catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

app.delete('/todos/:id', async (req, res) => {
  let id
  try {
    id = idSchema.parse(req.params.id)
  } catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await deleteTodo(id)
  } catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

// And expose a `POST /changes` route specifically to support the
// through the DB sync pattern.

const transactionsSchema = z.array(
  z.object({
    id: z.string(),
    changes: z.array(
      z.object({
        operation: z.string(),
        value: z.object({
          id: z.string().uuid(),
          title: z.string().optional(),
          completed: z.boolean().optional(),
          created_at: z.string().optional(),
        }),
        write_id: z.string(),
      })
    ),
  })
)

app.post('/changes', async (req, res) => {
  let data
  try {
    data = transactionsSchema.parse(req.body)
  } catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    data.forEach((tx) => {
      tx.changes.forEach(({ operation, value, write_id }) => {
        switch (operation) {
          case 'insert':
            createTodo(value.id, value.title, value.created_at, write_id)
            break

          case 'update':
            updateTodo(value.id, value.completed, write_id)
            break

          case 'delete':
            deleteTodo(value.id)
            break
        }
      })
    })

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')

    return res.status(500).json({ errors: err })
  } finally {
    await client.release()
  }

  return res.status(200).json({ status: 'OK' })
})

app.get('/health', (_req, res) => {
  return res.sendStatus(200)
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening at port ${PORT}`)
})
