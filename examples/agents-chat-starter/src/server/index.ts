import path from 'node:path'

// Load repo root .env first, then local .env (local values take precedence)
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, `../../../../.env`))
} catch {}
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, `../../.env`))
} catch {}

import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'
import http from 'node:http'
import { registerOptimist } from './optimist.js'
import { registerCritic } from './critic.js'

const AGENTS_URL = process.env.AGENTS_URL ?? `http://localhost:4437`
const PORT = Number(process.env.PORT ?? 4700)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()
registerOptimist(registry)
registerCritic(registry)

const runtime = createRuntimeHandler({
  baseUrl: AGENTS_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

interface Room {
  id: string
  name: string
  createdAt: number
  agents: Array<{ id: string; type: string; entityUrl: string }>
}

const rooms = new Map<string, Room>()

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

/** Send a message to a single entity via the /send inbox endpoint */
async function sendToEntity(
  entityUrl: string,
  text: string,
  from: string
): Promise<void> {
  const res = await fetch(`${AGENTS_URL}${entityUrl}/send`, {
    method: `POST`,
    headers: { 'Content-Type': `application/json` },
    body: JSON.stringify({ from, payload: text }),
  })
  if (!res.ok) {
    console.warn(`[server] send to ${entityUrl} failed: ${res.status}`)
  }
}

/** Broadcast a message to all agents in a room */
async function broadcastToRoom(
  room: Room,
  text: string,
  from: string
): Promise<void> {
  await Promise.all(
    room.agents.map((a) => sendToEntity(a.entityUrl, text, from))
  )
}

async function spawnAgent(room: Room, type: string): Promise<string> {
  const agentId = `${room.id}-${type}-${room.agents.length + 1}`
  const entityUrl = `/${type}/${agentId}`

  const putRes = await fetch(`${AGENTS_URL}${entityUrl}`, {
    method: `PUT`,
    headers: { 'Content-Type': `application/json` },
    body: JSON.stringify({
      args: { chatroomId: room.id },
      tags: { room_id: room.id },
      initialMessage: `You have joined chatroom "${room.name}". Wait for messages.`,
    }),
  })
  if (!putRes.ok) {
    const text = await putRes.text()
    throw new Error(`Spawn failed: ${text}`)
  }

  room.agents.push({ id: agentId, type, entityUrl })
  return agentId
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

  if (req.url === `/api/config` && req.method === `GET`) {
    writeJson(res, 200, { agentsUrl: AGENTS_URL })
    return
  }

  // List rooms
  if (req.url === `/api/rooms` && req.method === `GET`) {
    writeJson(
      res,
      200,
      Array.from(rooms.values()).map((r) => ({
        id: r.id,
        name: r.name,
        agentCount: r.agents.length,
        createdAt: r.createdAt,
      }))
    )
    return
  }

  // Create room + spawn default agents
  if (req.url === `/api/rooms` && req.method === `POST`) {
    try {
      const body = (await readJson(req)) as { name?: string }
      const id = crypto.randomUUID().slice(0, 8)
      const name = body.name ? `${body.name}-${id.slice(0, 4)}` : `room-${id}`
      const room: Room = { id, name, agents: [], createdAt: Date.now() }
      rooms.set(id, room)

      await spawnAgent(room, `optimist`)
      await spawnAgent(room, `critic`)

      writeJson(res, 200, {
        id: room.id,
        name: room.name,
        agentCount: room.agents.length,
        createdAt: room.createdAt,
      })
    } catch (err) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  // Room-scoped routes
  const roomMatch = req.url?.match(/^\/api\/rooms\/([^/]+)\/(\w+)$/)
  if (roomMatch) {
    const [, roomId, action] = roomMatch

    // Send user message — write to shared state + broadcast to all agents
    if (action === `message` && req.method === `POST`) {
      try {
        const body = (await readJson(req)) as { text?: string }
        if (!body.text) {
          writeJson(res, 400, { error: `Missing "text" field` })
          return
        }
        const room = rooms.get(roomId!)
        if (!room) {
          writeJson(res, 404, { error: `Room not found` })
          return
        }

        // Write to shared state so frontend sees it
        const event = {
          type: `shared:message`,
          headers: { operation: `insert` },
          value: {
            key: crypto.randomUUID(),
            role: `user`,
            sender: `user`,
            senderName: `You`,
            text: body.text,
            timestamp: Date.now(),
          },
        }
        await fetch(`${AGENTS_URL}/_electric/shared-state/${roomId}`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify(event),
        })

        // Send to all agents via inbox
        await broadcastToRoom(room, body.text, `user`)
        writeJson(res, 200, { ok: true })
      } catch (err) {
        writeJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    // Broadcast agent message to other agents (called by send_message tool)
    if (action === `broadcast` && req.method === `POST`) {
      try {
        const body = (await readJson(req)) as {
          text?: string
          from?: string
          excludeEntity?: string
        }
        const room = rooms.get(roomId!)
        if (!room || !body.text) {
          writeJson(res, 400, { error: `Invalid request` })
          return
        }

        // Send to all agents except the sender
        const targets = room.agents.filter(
          (a) => a.entityUrl !== body.excludeEntity
        )
        await Promise.all(
          targets.map((a) =>
            sendToEntity(
              a.entityUrl,
              `[${body.from}]: ${body.text}`,
              body.from ?? `agent`
            )
          )
        )
        writeJson(res, 200, { ok: true })
      } catch (err) {
        writeJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }

    // Spawn agent
    if (action === `agent` && req.method === `POST`) {
      try {
        const body = (await readJson(req)) as { type?: string }
        if (!body.type) {
          writeJson(res, 400, { error: `Missing "type" field` })
          return
        }
        const room = rooms.get(roomId!)
        if (!room) {
          writeJson(res, 404, { error: `Room not found` })
          return
        }
        const agentId = await spawnAgent(room, body.type)
        writeJson(res, 200, { agentId, type: body.type })
      } catch (err) {
        writeJson(res, 500, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
      return
    }
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`Chat server ready on port ${PORT}`)
  console.log(`Agents server: ${AGENTS_URL}`)
  console.log(`${runtime.typeNames.length} entity types registered`)
})
