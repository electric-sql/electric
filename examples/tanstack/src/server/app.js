import http from "http"
import pg from "pg"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client"

const baseUrl = process.env.ELECTRIC_URL ?? `http://localhost:3000`

const db = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ??
    `postgresql://postgres:password@localhost:54321/electric`,
})

// Async function to handle reading the body of the request
const getRequestBody = async (req) => {
  return new Promise((resolve, reject) => {
    let body = ``
    req.on(`data`, (chunk) => (body += chunk.toString()))
    req.on(`end`, () => resolve(body))
    req.on(`error`, reject)
  })
}

const JSON_HEADERS = {
  "Content-Type": `application/json`,
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": `*`,
  "Access-Control-Allow-Methods": `GET, POST, DELETE, OPTIONS`,
  "Access-Control-Allow-Headers": `Content-Type`,
}

const server = http.createServer(async (req, res) => {
  console.log(req.method, req.url)
  try {
    // Handle CORS preflight requests
    if (req.method === `OPTIONS`) {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    if (req.method === `GET` && (req.url === `/` || req.url === `/health`)) {
      // This is a health check
      res.writeHead(200, { ...JSON_HEADERS, ...CORS_HEADERS })
      res.end(JSON.stringify({ message: `OK` }))
      return
    }

    // Handle GET /items - proxy to Electric for syncing items
    if (req.method === `GET` && req.url.startsWith(`/items`)) {
      const url = new URL(req.url, `http://localhost:${PORT}`)
      const originUrl = new URL(`/v1/shape`, baseUrl)

      // Copy relevant query params
      url.searchParams.forEach((value, key) => {
        if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
          originUrl.searchParams.set(key, value)
        }
      })

      // Set the table server-side
      originUrl.searchParams.set(`table`, `items`)

      // Add source credentials if available
      if (process.env.ELECTRIC_SOURCE_ID) {
        originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
      }
      if (process.env.ELECTRIC_SOURCE_SECRET) {
        originUrl.searchParams.set(`secret`, process.env.ELECTRIC_SOURCE_SECRET)
      }

      try {
        const response = await fetch(originUrl)

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
        await pipeline(nodeStream, res)
        return
      } catch (error) {
        // Ignore premature close errors - these happen when clients disconnect early
        if (error.code === `ERR_STREAM_PREMATURE_CLOSE`) {
          return
        }

        console.error(`Error proxying to Electric:`, error)
        // Only write headers if they haven't been sent yet
        if (!res.headersSent) {
          res.writeHead(500, { ...JSON_HEADERS, ...CORS_HEADERS })
          res.end(JSON.stringify({ error: `Internal server error` }))
        }
        return
      }
    }

    // Handle adding an item
    if (req.method === `POST` && req.url === `/items`) {
      const body = await getRequestBody(req)
      const { id: newId } = JSON.parse(body)
      await db.query(`INSERT INTO items (id) VALUES ($1);`, [newId])
      res.writeHead(200, { ...JSON_HEADERS, ...CORS_HEADERS })
      res.end(JSON.stringify({ message: `Item added with id ${newId}` }))
      return
    }

    // Handle deleting all items
    if (req.method === `DELETE` && req.url === `/items`) {
      await db.query(`DELETE FROM items;`)
      res.writeHead(200, { ...JSON_HEADERS, ...CORS_HEADERS })
      res.end(JSON.stringify({ message: `All items deleted` }))
      return
    }

    res.writeHead(404, { ...JSON_HEADERS, ...CORS_HEADERS })
    res.end(JSON.stringify({ error: `Not Found` }))
  } catch (error) {
    console.error(`Error handling request:`, error)
    res.writeHead(500, { ...JSON_HEADERS, ...CORS_HEADERS })
    res.end(JSON.stringify({ error: `Something went wrong` }))
  }
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
