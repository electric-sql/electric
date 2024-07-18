import express from "express"
import bodyParser from "body-parser"
import cors from "cors"
import pg from "pg"
import { z } from "zod"

const { Client } = pg
const client = new Client({
  host: `localhost`,
  port: 54321,
  password: `password`,
  user: `postgres`,
  database: `electric`,
})
client.connect()

const port = 3010

const app = express()
// Middleware to parse JSON request bodies
app.use(bodyParser.json())
app.use(cors())

const idSchema = z.string().uuid()
const postSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
})
const putSchema = z.object({
  title: z.string().optional(),
  completed: z.boolean().optional(),
})

app.post(`/todos`, async (req, res) => {
  console.log(`create`, req.body, req.body.title)
  let parsedData
  try {
    parsedData = postSchema.parse(req.body)
    console.log({ parsedData })
  } catch (e) {
    // If validation fails, send the error messages back
    return res.status(400).json({ errors: e.errors })
  }
  try {
    await client.query(
      `insert into todos (id, title, completed, created_at) VALUES($1, $2, false, $3)`,
      [parsedData.id, parsedData.title, new Date()]
    )
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})

app.put(`/todos/:id`, async (req, res) => {
  const todoId = idSchema.parse(req.params.id)
  const body = putSchema.parse(req.body)
  console.log(`update`, todoId, body)
  try {
    const { query, values } = generateUpdateQuery(`todos`, body, {
      id: todoId,
    })
    console.log({ query, values })
    await client.query(query, values)
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})

app.delete(`/todos/:id`, async (req, res) => {
  const todoId = idSchema.parse(req.params.id)
  console.log(`delete`, todoId)
  try {
    await client.query(`DELETE from todos where id = $1`, [todoId])
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})

// --- Start the Server ---
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`)
})

/*
app.post(`/todos`, async (req: Request, res: Response) => {
  const body = req.body
  console.log(`create`, req.body, req.body.title)
  let parsedData
  try {
    parsedData = postSchema.parse(req.body)
    console.log({ parsedData })
  } catch (e) {
    // If validation fails, send the error messages back
    return res.status(400).json({ errors: e.errors })
  }
  try {
    await client.query(
      `insert into todos (id, title, completed, created_at) VALUES($1, $2, false, $3)`,
      [parsedData.id, parsedData.title, new Date()]
    )
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})
app.put(`/todos/:id`, async (req: Request, res: Response) => {
  const todoId = idSchema.parse(req.params.id)
  const body = putSchema.parse(req.body)
  console.log(`update`, todoId, body)
  try {
    const { query, values } = generateUpdateQuery(`todos`, body, {
      id: todoId,
    })
    console.log({ query, values })
    await client.query(query, values)
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})

app.delete(`/todos/:id`, async (req: Request, res: Response) => {
  const todoId = idSchema.parse(req.params.id)
  console.log(`delete`, todoId)
  try {
    await client.query(`DELETE from todos where id = $1`, [todoId])
  } catch (e) {
    console.log(`insert error`, e)
    return res.status(500).json({ errors: e })
  }
  res.send(`ok`)
})
*/

function generateUpdateQuery(table, updates, conditions) {
  const setClauses = []
  const values = []
  let index = 1

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`"${key}" = $${index}`)
    values.push(value)
    index++
  }

  const conditionClauses = []
  for (const [key, value] of Object.entries(conditions)) {
    conditionClauses.push(`"${key}" = $${index}`)
    values.push(value)
    index++
  }

  const query = `UPDATE "${table}" SET ${setClauses.join(`, `)} WHERE ${conditionClauses.join(` AND `)}`
  return { query, values }
}
