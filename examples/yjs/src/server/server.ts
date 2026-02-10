import { serve } from "@hono/node-server"
import { Hono } from "hono"
import type { Context } from "hono"
import { cors } from "hono/cors"
import pg, { Pool } from "pg"
import { logger } from "hono/logger"

type InvalidRequest = { isValid: false; error?: string }
type ValidRequest = (Update | AwarenessUpdate) & { isValid: true }

export type Update = {
  room: string
  update: Uint8Array
}

export type AwarenessUpdate = Update & {
  client_id: string
}

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://postgres:password@localhost:54321/electric`

const pool = new pg.Pool({ connectionString })

const app = new Hono()
app.use(logger())
app.use(
  cors({
    origin: `*`,
    allowHeaders: [`Content-Type`, `Authorization`],
    allowMethods: [`GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`],
    credentials: true,
    maxAge: 600,
  })
)

const parseRequest = async (
  c: Context
): Promise<ValidRequest | InvalidRequest> => {
  const url = new URL(c.req.url)
  const room = url.searchParams.get(`room`)

  if (!room) {
    return { isValid: false, error: `Room is required` }
  }

  const client_id = url.searchParams.get(`client_id`) ?? undefined

  // Get update binary from request body
  const arrayBuffer = await c.req.arrayBuffer()
  const update = new Uint8Array(arrayBuffer)

  if (update.length === 0) {
    return { isValid: false, error: `No update provided` }
  }
  if (client_id) {
    return { isValid: true, room, client_id, update }
  } else {
    return { isValid: true, room, update }
  }
}

app.put(`/api/update`, async (c: Context) => {
  try {
    const requestParams = await parseRequest(c)
    if (!requestParams.isValid) {
      return c.json({ error: requestParams }, 400)
    }

    if (`client_id` in requestParams) {
      await upsertAwarenessUpdate(requestParams, pool)
    } else {
      await saveUpdate(requestParams, pool)
    }

    return c.json({})
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return c.json({ error: message }, 400)
  }
})

// Shape proxy endpoint to forward requests to Electric
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

  // Copy all headers from the original request to forward to Electric
  const headers = new Headers()
  c.req.raw.headers.forEach((value, key) => {
    if (key !== `host`) {
      // Skip host header to avoid conflicts
      headers.set(key, value)
    }
  })

  if (process.env.ELECTRIC_SOURCE_SECRET) {
    originUrl.searchParams.set(`secret`, process.env.ELECTRIC_SOURCE_SECRET)
  }

  // Make the request to Electric
  try {
    const newRequest = new Request(originUrl.toString(), {
      method: `GET`,
      headers,
    })

    const resp = await fetch(newRequest)

    // Create a new Response with mutable headers so that
    // Hono's CORS middleware can merge its headers in
    const respHeaders = new Headers(resp.headers)
    if (respHeaders.get(`content-encoding`)) {
      respHeaders.delete(`content-encoding`)
      respHeaders.delete(`content-length`)
    }

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: respHeaders,
    })
  } catch (error) {
    console.error(`Error proxying to Electric:`, error)
    return c.json({ error: `Failed to proxy request to Electric` }, 500)
  }
})

app.get(`/health`, (c: Context) => {
  return c.body(null, 200)
})

// Start the server
const port = process.env.PORT ? parseInt(process.env.PORT) : 3002
console.log(`Server is running on port ${port}`)

// Export the app for testing purposes
export const honoApp = app

serve({
  fetch: app.fetch,
  port,
})

export async function saveUpdate({ room, update }: Update, pool: Pool) {
  const q = `INSERT INTO ydoc_update (room, update) VALUES ($1, $2)`
  const params = [room, update]
  await pool.query(q, params)
}

export async function upsertAwarenessUpdate(
  { room, client_id, update }: AwarenessUpdate,
  pool: Pool
) {
  const q = `INSERT INTO ydoc_awareness (room, client_id, update) VALUES ($1, $2, $3)
         ON CONFLICT (client_id, room) DO UPDATE SET update = $3, updated_at = now()`
  const params = [room, client_id, update]
  await pool.query(q, params)
}
