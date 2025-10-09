import express from "express"
import cors from "cors"
import { db } from "../src/db"
import { todos } from "../src/db/schema"
import { validateInsertTodo, validateUpdateTodo } from "../src/db/schema"
import { sql, eq } from "drizzle-orm"
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"
import { Readable } from "stream"
import { pipeline } from "stream/promises"

// Create Express app
const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get(`/api/health`, (_req, res) => {
  res.status(200).json({ status: `ok` })
})

// Generate a transaction ID
async function generateTxId(tx: any): Promise<number> {
  // This is specific to postgres and how electricsql works
  const [{ txid }] = await tx.execute(sql`SELECT txid_current() as txid`)
  return Number(txid)
}

// ===== TODOS API =====

// POST create a new todo
app.post(`/api/todos`, async (req, res) => {
  try {
    const todoData = validateInsertTodo(req.body)

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx)
      const [newTodo] = await tx.insert(todos).values(todoData).returning()
      return { todo: newTodo, txid }
    })

    res.status(201).json(result)
  } catch (error) {
    console.error(`Error creating todo:`, error)
    res.status(500).json({
      error: `Failed to create todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// PUT update a todo
app.put(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params
    const todoData = validateUpdateTodo(req.body)

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx)
      const [updatedTodo] = await tx
        .update(todos)
        .set({ ...todoData, updated_at: new Date() })
        .where(eq(todos.id, Number(id)))
        .returning()

      if (!updatedTodo) {
        throw new Error(`Todo not found`)
      }
      return { todo: updatedTodo, txid }
    })

    res.status(200).json(result)
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error updating todo:`, error)
    res.status(500).json({
      error: `Failed to update todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// DELETE a todo
app.delete(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params

    const result = await db.transaction(async (tx) => {
      const txid = await generateTxId(tx)
      const [deleted] = await tx
        .delete(todos)
        .where(eq(todos.id, Number(id)))
        .returning({ id: todos.id })

      if (!deleted) {
        throw new Error(`Todo not found`)
      }
      return { success: true, txid }
    })

    res.status(200).json(result)
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error deleting todo:`, error)
    res.status(500).json({
      error: `Failed to delete todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// GET proxy Electric shape requests for todos
app.get(`/api/todos`, async (req, res) => {
  try {
    const ELECTRIC_URL = process.env.ELECTRIC_URL || `http://localhost:3000`

    const electricUrl = new URL(`${ELECTRIC_URL}/v1/shape`)

    // Only pass through Electric protocol parameters
    Object.keys(req.query).forEach((key) => {
      if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key as any)) {
        electricUrl.searchParams.set(key, req.query[key] as string)
      }
    })

    // Set the table server-side
    electricUrl.searchParams.set(`table`, `todos`)

    // Inner try for fetch
    const response = await fetch(electricUrl)

    if (!response.ok) {
      const errorText = await response.text()
      res.writeHead(response.status, { "Content-Type": `application/json` })
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
  } catch (outerError) {
    if (!res.headersSent) {
      res.status(500).json({
        error: `Internal server error`,
        details: (outerError as any).message,
      })
    }
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
