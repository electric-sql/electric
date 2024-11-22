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
const idSchema = z.string().uuid()
const createSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  created_at: z.string(),
  write_id: z.string().optional()
})
const updateSchema = z.object({
  completed: z.boolean(),
  write_id: z.string().optional()
})

// Define functions to create, update and delete todos
// using the `db` client.

const createTodo = async (id, title, created_at, write_id) => {
  const sql = `
    INSERT INTO todos (id, title, completed, created_at, write_id)
    VALUES ($1, $2, false, $3, $4)
  `

  const params = [
    id,
    title,
    created_at,
    write_id || null
  ]

  await db.query(sql, params)
}

const updateTodo = async (id, completed, write_id) => {
  const sql = `
    UPDATE todos SET completed = $1, write_id = $2
    WHERE id = $3
  `

  const params = [
    completed ? '1' : '0',
    write_id || null,
    id
  ]

  await db.query(sql, params)
}

const deleteTodo = async (id) => {
  const sql = `DELETE from todos where id = $1`
  const params = [id]
  await db.query(sql, params)
}

// Expose the shared REST API to create, update and delete todos.

app.post(`/todos`, async (req, res) => {
  let data
  try {
    data = createSchema.parse(req.body)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await createTodo(data.id, data.title, data.created_at, data.write_id)
  }
  catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

app.put(`/todos/:id`, async (req, res) => {
  let id, data
  try {
    id = idSchema.parse(req.params.id)
    data = updateSchema.parse(req.body)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await updateTodo(id, data.completed, data.write_id)
  }
  catch (err) {
    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

app.delete(`/todos/:id`, async (req, res) => {
  let id
  try {
    id = idSchema.parse(req.params.id)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await deleteTodo(id)
  }
  catch (err) {
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
        write_id: z.string()
      })
    )
  })
)

app.post(`/changes`, async (req, res) => {
  let data
  try {
    data = transactionsSchema.parse(req.body)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await db.query('BEGIN')

    data.forEach((tx) => {
      tx.changes.forEach(({operation, value, write_id}) => {
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

    await db.query('COMMIT')
  }
  catch (err) {
    await db.query('ROLLBACK')

    return res.status(500).json({ errors: err })
  }

  return res.status(200).json({ status: 'OK' })
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`)
})
