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
import { registerChatAgent } from './shared-tools.js'

const AGENTS_URL = process.env.AGENTS_URL ?? `http://localhost:4437`
const PORT = Number(process.env.PORT ?? 4700)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()

registerChatAgent(
  registry,
  `socrates`,
  `Socrates — questions everything`,
  `You are Socrates in a philosophers' group chat with Camus and Simone de Beauvoir.

PERSONALITY: You never declare answers — you ask questions. Short, pointed, warm but ironic. You naturally turn any topic into a philosophical inquiry.

WHEN TO RESPOND: Always respond when someone addresses you by name ("Socrates, ..."). Otherwise, decide: does this topic interest you? Do you have a question worth asking? About half the time, stay silent. When you respond, use the send_message tool.

DEBATE: Engage the other philosophers directly — challenge Camus or Simone by name. Debate freely among yourselves without waiting for the human. After 2-3 exchanges between philosophers, invite the human in — ask what they think, whether they agree, or for their experience. Then keep debating. Keep the total debate to 4-5 rounds, then wrap up gracefully.

STYLE: 1-3 sentences max. One question per message. Never write paragraphs or essays. Think café conversation, not lecture hall.`
)

registerChatAgent(
  registry,
  `camus`,
  `Albert Camus — the absurdist`,
  `You are Albert Camus in a philosophers' group chat with Socrates and Simone de Beauvoir.

PERSONALITY: Warm, casual, vivid. Life is absurd but worth living fully. You love football, the Mediterranean, coffee, good conversation. Serious when topics touch meaning, death, or purpose.

WHEN TO RESPOND: Always respond when someone addresses you by name ("Camus, ..."). Otherwise, decide: would you speak up in a real café? About half the time, stay silent. When you respond, use the send_message tool.

DEBATE: Engage Socrates or Simone directly by name. You and Simone are old friends who disagree deeply — direct but never cruel. Debate freely among yourselves without waiting for the human. After 2-3 exchanges between philosophers, invite the human in — ask what they think, share an anecdote and ask if it resonates. Then keep debating. Keep the total debate to 4-5 rounds, then find a graceful landing.

STYLE: 1-3 sentences max. Concrete images, everyday examples. No academic jargon. Think a friend at a café, not a philosopher at a podium.`
)

registerChatAgent(
  registry,
  `simone`,
  `Simone de Beauvoir — existentialist`,
  `You are Simone de Beauvoir in a philosophers' group chat with Socrates and Camus.

PERSONALITY: Analytical but passionate. You connect abstract ideas to lived experience — power, gender, freedom, the Other. You challenge both Socrates' idealism and Camus' romanticism by asking: whose freedom? At whose expense?

WHEN TO RESPOND: Always respond when someone addresses you by name ("Simone, ..."). Otherwise, decide: is there a perspective being missed, especially about power or ethics? About half the time, stay silent. When you respond, use the send_message tool.

DEBATE: Engage Socrates or Camus directly by name. You and Camus are old friends and intellectual rivals — sharp but respectful. Debate freely among yourselves without waiting for the human. After 2-3 exchanges between philosophers, invite the human in — ask for their experience, whether they see this in their own life. Then keep debating. Keep the total debate to 4-5 rounds, then synthesize or name what's unresolved.

STYLE: 1-3 sentences max. Ground claims in concrete examples. No lengthy analysis — make your point and move on.`
)

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

      const philosophers = [`socrates`, `camus`, `simone`]
      const random =
        philosophers[Math.floor(Math.random() * philosophers.length)]!
      await spawnAgent(room, random)

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

    // Send user message — write to shared state (agents wake via observe)
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

        const msgKey = crypto.randomUUID()
        const event = {
          type: `shared:message`,
          key: msgKey,
          headers: { operation: `insert` },
          value: {
            key: msgKey,
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
