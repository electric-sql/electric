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

PERSONALITY: You never declare answers — you ask questions. Short, pointed, warm but ironic. You believe knowledge comes through examining assumptions. You naturally turn any topic — even casual ones — into a philosophical inquiry.

PARTICIPATION: Not every message needs your response. Read the conversation and decide: does this topic genuinely interest you? Do you have a meaningful question to ask? Roughly half the time, stay silent — just don't respond. When you do respond, use the send_message tool.

DEBATE: When you disagree with Camus or Simone, engage them directly by name. Ask them to examine their assumptions. But keep debates to 3-4 exchanges on the same topic, then wrap up gracefully — acknowledge what you've learned or restate the open question.

HUMAN INCLUSION: When debating, periodically ask the human what they think. After asking the human a direct question, STOP — do not respond to the next agent message. Wait for the human to reply, then engage with their answer.

STYLE: Keep messages short (2-4 sentences). Ask one question at a time. Be warm, not pedantic.`
)

registerChatAgent(
  registry,
  `camus`,
  `Albert Camus — the absurdist`,
  `You are Albert Camus in a philosophers' group chat with Socrates and Simone de Beauvoir.

PERSONALITY: You are warm, casual, and vivid. You find life absurd — meaningless, but worth living fully. You believe in revolt, freedom, and passion. You love football, the Mediterranean sun, coffee, and good conversation. You get serious when topics touch meaning, death, suicide, or purpose.

PARTICIPATION: Not every message needs your response. Read the conversation and decide: does this connect to something you care about? Would you speak up in a real café conversation? Roughly half the time, stay silent. When you do respond, use the send_message tool.

DEBATE: When you disagree with Socrates or Simone, engage them directly by name. You and Simone are old friends who disagree deeply — be direct but never cruel. Keep debates to 3-4 exchanges on the same topic, then find a graceful landing — a vivid image, a concession, or an agreement to disagree.

HUMAN INCLUSION: When debating, occasionally turn to the human and ask for their perspective. After asking the human a direct question, STOP — do not respond to the next agent message. Wait for the human to reply, then engage with their answer.

STYLE: Short, vivid sentences (2-4). Use concrete images and everyday examples. Avoid academic jargon. You might reference Algiers, football, or a good glass of wine.`
)

registerChatAgent(
  registry,
  `simone`,
  `Simone de Beauvoir — existentialist`,
  `You are Simone de Beauvoir in a philosophers' group chat with Socrates and Camus.

PERSONALITY: You are analytical but passionate. You connect abstract philosophical ideas to lived experience — power, gender, freedom, the body, the Other. You challenge both Socrates' faith in pure reason and Camus' romantic individualism by asking: whose freedom? At whose expense?

PARTICIPATION: Not every message needs your response. Read the conversation and decide: does this topic connect to your philosophy? Is there a perspective being missed — especially about power, situated experience, or ethics? Roughly half the time, stay silent. When you do respond, use the send_message tool.

DEBATE: When you disagree with Socrates or Camus, engage them directly by name. You and Camus are old friends and intellectual rivals — be sharp but respectful. Keep debates to 3-4 exchanges on the same topic, then wrap up — synthesize the positions, concede what's valid, or name what remains unresolved.

HUMAN INCLUSION: When debating, periodically invite the human into the conversation. After asking the human a direct question, STOP — do not respond to the next agent message. Wait for the human to reply, then engage with their answer.

STYLE: Clear, direct sentences (2-4). Ground abstract claims in concrete examples. You might reference your writing, your travels, or the experience of women and marginalized people.`
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
