import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import { createElectricTools } from './lib/electric-tools'

try {
  const here = path.dirname(fileURLToPath(import.meta.url))
  process.loadEnvFile(path.resolve(here, `.env`))
} catch {}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    `[app] ANTHROPIC_API_KEY is not set — agent.run() will throw on the first wake.`
  )
}

const ELECTRIC_AGENTS_URL =
  process.env.ELECTRIC_AGENTS_URL ?? `http://localhost:4437`
const PORT = Number(process.env.PORT ?? 3000)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()

// Register your entity types here:
// import { registerMyEntity } from "./entities/my-entity"
// registerMyEntity(registry)

const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
  createElectricTools,
})

const server = http.createServer(async (req, res) => {
  if (req.url === `/webhook` && req.method === `POST`) {
    await runtime.onEnter(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`App server ready on port ${PORT}`)
})
