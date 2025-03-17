import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const port = 8080

const mimeTypes = {
  '.html': `text/html`,
  '.js': `text/javascript`,
  '.css': `text/css`,
  '.json': `application/json`,
  '.mjs': `text/javascript`,
}

const server = http.createServer((req, res) => {
  console.log(`Request for ${req.url}`)

  // Redirect root to index.html
  let filePath =
    req.url === `/`
      ? path.join(__dirname, `index.html`)
      : path.join(__dirname, req.url)

  // Default to repository root for any path not found in the example directory
  const repoRoot = path.join(__dirname, `../..`)

  const extname = path.extname(filePath)
  let contentType = mimeTypes[extname] || `application/octet-stream`

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Try to find the file in the repository root
      filePath = path.join(repoRoot, req.url)

      fs.readFile(filePath, (err2, content2) => {
        if (err2) {
          if (err2.code === `ENOENT`) {
            res.writeHead(404)
            res.end(`File not found: ` + req.url)
          } else {
            res.writeHead(500)
            res.end(`Server Error: ` + err2.code)
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType })
          res.end(content2, `utf-8`)
        }
      })
    } else {
      res.writeHead(200, { 'Content-Type': contentType })
      res.end(content, `utf-8`)
    }
  })
})

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`)
})
