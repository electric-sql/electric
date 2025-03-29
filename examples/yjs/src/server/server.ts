import { serve } from "@hono/node-server"
import { Hono } from "hono"
import type { Context } from "hono"
import pg from "pg"
const { Pool } = pg
import * as db from "./db"
import { logger } from "hono/logger"

type InvalidRequest = { isValid: false; error?: string }
type ValidRequest = (db.Operation | db.AwarenessOperation) & { isValid: true }

// Database connection setup
const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`

const pool = new Pool({ connectionString })

const app = new Hono()
app.use(logger())

const parseRequest = async (
  c: Context
): Promise<ValidRequest | InvalidRequest> => {
  const url = new URL(c.req.url)
  const room = url.searchParams.get(`room`)

  if (!room) {
    return { isValid: false, error: `Room is required` }
  }

  const client_id = url.searchParams.get(`client_id`) ?? undefined

  // Get operation data from request body
  const arrayBuffer = await c.req.arrayBuffer()
  const op = new Uint8Array(arrayBuffer)

  if (op.length === 0) {
    return { isValid: false, error: `Operation is required` }
  }
  if (client_id) {
    return { isValid: true, room, client_id, op }
  } else {
    return { isValid: true, room, op }
  }
}

app.put(`/api/operation`, async (c: Context) => {
  try {
    const requestParams = await parseRequest(c)
    if (!requestParams.isValid) {
      return c.json({ error: requestParams.error }, 400)
    }

    if (`client_id` in requestParams) {
      await db.upsertAwarenessOperation(requestParams, pool)
    } else {
      await db.saveOperation(requestParams, pool)
    }

    return c.json({})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json({ error: message }, 400)
  }
})

// Shape proxy endpoint to forward requests to Electric and handle required headers
app.get(`/shape-proxy/v1/shape`, async (c: Context) => {
  const url = new URL(c.req.url)
  const electricUrl = process.env.ELECTRIC_URL || `http://localhost:3000`
  const originUrl = new URL(`${electricUrl}/v1/shape/`)

  // Forward all query parameters
  url.searchParams.forEach((value, key) => {
    originUrl.searchParams.set(key, value)
  })

  // Add Electric source ID and secret if available
  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
  }

  const headers = new Headers()
  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set(
      `source_secret`,
      process.env.ELECTRIC_SOURCE_SECRET
    )
  }

  // Make the request to Electric
  try {
    const newRequest = new Request(originUrl.toString(), {
      method: `GET`,
      headers,
    })

    let resp = await fetch(newRequest)

    // Handle content-encoding issues
    if (resp.headers.get(`content-encoding`)) {
      const respHeaders = new Headers(resp.headers)
      respHeaders.delete(`content-encoding`)
      respHeaders.delete(`content-length`)
      resp = new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      })
    }

    // Create a response with all headers from the Electric response
    const responseHeaders = new Headers()
    resp.headers.forEach((value, key) => {
      responseHeaders.set(key, value)
    })

    return new Response(resp.body, {
      status: resp.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error(`Error proxying to Electric:`, error)
    return c.json({ error: `Failed to proxy request to Electric` }, 500)
  }
})

// Start the server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3002
console.log(`Server is running on port ${port}`)

// Export the app for testing purposes
export const honoApp = app

// Only start the server if this file is run directly
if (import.meta.url === new URL(import.meta.url).href) {
  serve({
    fetch: app.fetch,
    port,
  })
}
