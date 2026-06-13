/**
 * Launch the reference Node server (file-backed) for benchmarking.
 * Usage: PORT=4565 DATA_DIR=.streams-dev/bench-node pnpm exec tsx packages/server-rust/bench/node-server.ts
 */
import { mkdirSync } from "node:fs"
import { DurableStreamTestServer } from "../../server/src/server"

const port = Number(process.env.PORT ?? 4565)
const dataDir = process.env.DATA_DIR ?? `.streams-dev/bench-node`
mkdirSync(dataDir, { recursive: true })

const server = new DurableStreamTestServer({
  port,
  host: `127.0.0.1`,
  dataDir,
  webhooks: false,
})

const url = await server.start()
console.log(`node server listening on ${url} (data: ${dataDir})`)
