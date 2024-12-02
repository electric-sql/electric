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
})
const updateSchema = z.object({
  completed: z.boolean()
})

// Define functions to create, update and delete todos
// using the `db` client.

const createTodo = async (id, title, created_at) => {
  const sql = `
    INSERT INTO todos (id, title, completed, created_at)
    VALUES ($1, $2, false, $3)
  `

  const params = [id, title, created_at]

  return await db.query(sql, params)
}

const updateTodo = async (id, completed) => {
  const sql = `
    UPDATE todos SET completed = $1
    WHERE id::text = $2
  `

  const params = [
    completed ? '1' : '0',
    id
  ]

  return await db.query(sql, params)
}

const deleteTodo = async (id) => {
  const sql = `DELETE from todos where id = $1`
  const params = [id]

  return await db.query(sql, params)
}

// Expose the API.

app.post(`/todos`, async (req, res) => {
  let data
  try {
    data = createSchema.parse(req.body)
  }
  catch (err) {
    return res.status(400).json({ errors: err.errors })
  }

  try {
    await createTodo(data.id, data.title, data.created_at)
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
    await updateTodo(id, data.completed)
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

// Start the server
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`)
})
