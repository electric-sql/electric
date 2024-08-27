import http from "http"
import pgPkg from "pg"

const { Client } = pgPkg

const db = new Client({
  host: `localhost`,
  port: 54321,
  password: `password`,
  user: `postgres`,
  database: `electric`,
})

db.connect()

// Async function to handle reading the body of the request
const getRequestBody = async (req) => {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk.toString()))
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const server = http.createServer(async (req, res) => {
  console.log(req.method, req.url)
  try {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.writeHead
      res.end()
      return
    }

    // Handle adding an item
    if (req.method === "POST" && req.url === "/items") {
      const body = await getRequestBody(req)
      const { id: newId } = JSON.parse(body)
      await db.query(`INSERT INTO items (id) VALUES ($1);`, [newId])
      res.writeHead(200, { ...JSON_HEADERS, ...CORS_HEADERS })
      res.end(JSON.stringify({ message: `Item added with id ${newId}` }))
      return
    }

    // Handle deleting all items
    if (req.method === "DELETE" && req.url === "/items") {
      await db.query(`DELETE FROM items;`)
      res.writeHead(200, { ...JSON_HEADERS, ...CORS_HEADERS })
      res.end(JSON.stringify({ message: "All items deleted" }))
      return
    }

    res.writeHead(404, { ...JSON_HEADERS, ...CORS_HEADERS })
    res.end(JSON.stringify({ error: "Not Found" }))
  } catch (error) {
    res.writeHead(500, { ...JSON_HEADERS, ...CORS_HEADERS })
    res.end(JSON.stringify({ error: "Something went wrong" }))
  }
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
