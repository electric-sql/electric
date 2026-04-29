import path from 'node:path'

// Load repo root .env first, then local .env (local values take precedence)
const envPaths = [
  path.resolve(import.meta.dirname, `../../../../.env`),
  path.resolve(import.meta.dirname, `../../.env`),
]
for (const envPath of envPaths) {
  try {
    process.loadEnvFile(envPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== `ENOENT`) {
      console.error(`Failed to load .env file:`, err)
    }
  }
}

import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import http from 'node:http'
import { registerOrchestrator } from './orchestrator.js'
import { registerSurveyWorker } from './survey-worker.js'

const DARIX_URL = process.env.DARIX_URL ?? `http://localhost:4437`
const PORT = Number(process.env.PORT ?? 4700)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()
registerOrchestrator(registry)
registerSurveyWorker(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

function writeJson(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  res.writeHead(status, {
    'Content-Type': `application/json`,
    'Access-Control-Allow-Origin': `*`,
  })
  res.end(JSON.stringify(body))
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString(`utf8`))
}

const server = http.createServer(async (req, res) => {
  if (req.method === `OPTIONS`) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': `*`,
      'Access-Control-Allow-Methods': `POST, GET, OPTIONS`,
      'Access-Control-Allow-Headers': `Content-Type`,
    })
    res.end()
    return
  }

  if (req.url === `/webhook` && req.method === `POST`) {
    await runtime.onEnter(req, res)
    return
  }

  if (req.url === `/api/swarm` && req.method === `POST`) {
    try {
      const body = (await readJson(req)) as {
        name?: string
        corpus?: string
        message?: string
      }

      const name = body.name ?? crypto.randomUUID().slice(0, 8)
      const message =
        body.message ??
        (body.corpus
          ? `Explore this corpus: ${body.corpus}`
          : `Explore the React source code — map the reconciler, hooks, scheduler, and all major subsystems.`)

      const tags: Record<string, string> = {
        swarm_id: name,
        title: message.trim().slice(0, 80),
      }

      const putRes = await fetch(`${DARIX_URL}/orchestrator/${name}`, {
        method: `PUT`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({
          args: {},
          tags,
          initialMessage: message,
        }),
      })

      if (!putRes.ok) {
        const text = await putRes.text()
        writeJson(res, 500, { error: `spawn failed: ${text}` })
        return
      }

      writeJson(res, 200, {
        name,
        orchestratorUrl: `/orchestrator/${name}`,
        swarmId: name,
      })
    } catch (err) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  if (req.url === `/api/config` && req.method === `GET`) {
    writeJson(res, 200, { darixUrl: DARIX_URL })
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`Deep Survey server ready on port ${PORT}`)
  console.log(`DARIX: ${DARIX_URL}`)
  console.log(`${runtime.typeNames.length} entity types registered`)
})
