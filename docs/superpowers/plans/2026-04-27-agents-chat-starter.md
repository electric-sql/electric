# Electric Agents Chat Starter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal starter project (`examples/agents-chat-starter/`) that demonstrates Electric agents in a shared chatroom with two agent types (Researcher and Assistant).

**Architecture:** React+Vite frontend subscribes to a shared state durable stream for chat messages. Node.js backend registers two entity types with agents-runtime, creates chatroom streams, appends user messages, and spawns agents. Agents observe the shared state with wake-on-change and respond via a `send_message` tool.

**Tech Stack:** agents-runtime, TanStack DB, React 19, Vite 7, Zod 4, Node.js HTTP server

**Spec:** `docs/superpowers/specs/2026-04-27-agents-chat-starter-design.md`

---

## File Map

| File                                                               | Responsibility                                      |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `examples/agents-chat-starter/package.json`                        | Dependencies, scripts                               |
| `examples/agents-chat-starter/tsconfig.json`                       | TypeScript config                                   |
| `examples/agents-chat-starter/vite.config.ts`                      | Vite + React, dev proxy                             |
| `examples/agents-chat-starter/.env.example`                        | Environment template                                |
| `examples/agents-chat-starter/src/server/schema.ts`                | Zod message schema + shared state schema            |
| `examples/agents-chat-starter/src/server/shared-tools.ts`          | `send_message`, `web_search`, `read_messages` tools |
| `examples/agents-chat-starter/src/server/assistant.ts`             | Assistant entity definition                         |
| `examples/agents-chat-starter/src/server/researcher.ts`            | Researcher entity definition                        |
| `examples/agents-chat-starter/src/server/index.ts`                 | HTTP server, routes, runtime setup                  |
| `examples/agents-chat-starter/src/ui/index.html`                   | HTML shell                                          |
| `examples/agents-chat-starter/src/ui/main.tsx`                     | App entry, room lifecycle, layout                   |
| `examples/agents-chat-starter/src/ui/main.css`                     | Minimal chat styles                                 |
| `examples/agents-chat-starter/src/ui/hooks/useChatroom.ts`         | Shared state subscription (messages + agents)       |
| `examples/agents-chat-starter/src/ui/hooks/useEntityTypes.ts`      | Fetch entity types from registry                    |
| `examples/agents-chat-starter/src/ui/components/MessageBubble.tsx` | Single chat message                                 |
| `examples/agents-chat-starter/src/ui/components/AgentBar.tsx`      | Active agents + spawn controls                      |
| `examples/agents-chat-starter/src/ui/components/ChatRoom.tsx`      | Message list + input                                |

---

### Task 1: Project Scaffolding

**Files:**

- Create: `examples/agents-chat-starter/package.json`
- Create: `examples/agents-chat-starter/tsconfig.json`
- Create: `examples/agents-chat-starter/vite.config.ts`
- Create: `examples/agents-chat-starter/.env.example`
- Create: `examples/agents-chat-starter/src/ui/index.html`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@electric-ax/example-agents-chat-starter",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "pnpm run --parallel \"/^dev:/\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:ui": "vite",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@durable-streams/state": "npm:@electric-ax/durable-streams-state-beta@^0.3.0",
    "@electric-ax/agents-runtime": "workspace:*",
    "@mariozechner/pi-agent-core": "^0.57.1",
    "@sinclair/typebox": "^0.34.0",
    "@tanstack/db": "^0.6.0",
    "@tanstack/react-db": "^0.1.78",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.2.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^7.2.4"
  }
}
```

Write to `examples/agents-chat-starter/package.json`.

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@tanstack/db": ["./node_modules/@tanstack/db"]
    }
  },
  "include": ["src"]
}
```

Write to `examples/agents-chat-starter/tsconfig.json`.

- [ ] **Step 3: Create vite.config.ts**

```typescript
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const tanstackDbPath = path.resolve(
  import.meta.dirname,
  `node_modules/@tanstack/db`
)

export default defineConfig({
  root: `src/ui`,
  plugins: [react()],
  resolve: {
    alias: {
      '@tanstack/db': tanstackDbPath,
    },
  },
  server: {
    port: 5175,
    open: false,
    proxy: {
      '/api': `http://localhost:4700`,
    },
  },
  build: {
    outDir: `../../dist`,
    emptyOutDir: true,
  },
})
```

Write to `examples/agents-chat-starter/vite.config.ts`.

- [ ] **Step 4: Create .env.example**

```
# Required — Anthropic API key for agent LLM calls
ANTHROPIC_API_KEY=

# Optional — Brave Search API key for the Researcher agent's web search tool
# Get one at https://brave.com/search/api/
BRAVE_SEARCH_API_KEY=

# Agents server URL (default: local quickstart)
DARIX_URL=http://localhost:4437

# Backend server port
PORT=4700
```

Write to `examples/agents-chat-starter/.env.example`.

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Electric Agents Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

Write to `examples/agents-chat-starter/src/ui/index.html`.

- [ ] **Step 6: Commit**

```bash
cd examples/agents-chat-starter
git add package.json tsconfig.json vite.config.ts .env.example src/ui/index.html
git commit -m "feat(agents-chat-starter): scaffold project"
```

---

### Task 2: Shared Schema

**Files:**

- Create: `examples/agents-chat-starter/src/server/schema.ts`

- [ ] **Step 1: Create schema.ts**

This file defines the Zod schema for chat messages and the shared state DB schema. Both the server entities and the frontend import this.

```typescript
import { z } from 'zod'

export const messageSchema = z.object({
  key: z.string().min(1),
  role: z.enum([`user`, `agent`]),
  sender: z.string().min(1),
  senderName: z.string().min(1),
  text: z.string().min(1),
  timestamp: z.number(),
})

export type Message = z.infer<typeof messageSchema>

export const chatroomSchema = {
  messages: {
    schema: messageSchema,
    type: `shared:message`,
    primaryKey: `key`,
  },
} as const
```

Write to `examples/agents-chat-starter/src/server/schema.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/server/schema.ts
git commit -m "feat(agents-chat-starter): add chatroom shared state schema"
```

---

### Task 3: Shared Tools

**Files:**

- Create: `examples/agents-chat-starter/src/server/shared-tools.ts`

These are the tools available to agents: `send_message` (both agents), `web_search` (researcher only), and `read_messages` (both agents, for reading chat history as context).

- [ ] **Step 1: Create shared-tools.ts**

```typescript
import { Type } from '@sinclair/typebox'
import type { AgentTool, SharedStateHandle } from '@electric-ax/agents-runtime'
import { chatroomSchema, type Message } from './schema.js'

export type ChatroomState = SharedStateHandle<typeof chatroomSchema>

const BRAVE_API_URL = `https://api.search.brave.com/res/v1/web/search`

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: `text` as const, text }],
    details,
  }
}

type MessageCollection = ChatroomState[`messages`]

async function awaitPersisted(transaction: unknown): Promise<void> {
  const promise = (
    transaction as { isPersisted?: { promise?: Promise<unknown> } } | null
  )?.isPersisted?.promise
  if (promise) await promise
}

export function createSendMessageTool(
  messages: MessageCollection,
  entityUrl: string,
  displayName: string
): AgentTool {
  return {
    name: `send_message`,
    label: `Send Message`,
    description: `Post a message to the chatroom. Use this to share your response with the user.`,
    parameters: Type.Object({
      text: Type.String({ description: `The message text to send` }),
    }),
    execute: async (_toolCallId, params) => {
      const { text } = params as { text: string }
      const transaction = (messages as any).insert({
        key: crypto.randomUUID(),
        role: `agent`,
        sender: entityUrl,
        senderName: displayName,
        text,
        timestamp: Date.now(),
      })
      await awaitPersisted(transaction)
      return textResult(`Message sent.`, { text })
    },
  }
}

export function createReadMessagesTool(messages: MessageCollection): AgentTool {
  return {
    name: `read_messages`,
    label: `Read Messages`,
    description: `Read recent messages from the chatroom to understand the conversation context.`,
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({
          description: `Maximum number of recent messages to return. Defaults to 50.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { limit = 50 } = params as { limit?: number }
      const allMessages = (messages as any).toArray as Message[]
      const sorted = [...allMessages]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-limit)

      if (sorted.length === 0) {
        return textResult(`No messages in the chatroom yet.`, { count: 0 })
      }

      const formatted = sorted
        .map((m) => `[${m.senderName}]: ${m.text}`)
        .join(`\n`)
      return textResult(formatted, { count: sorted.length })
    },
  }
}

export function createWebSearchTool(): AgentTool {
  return {
    name: `web_search`,
    label: `Web Search`,
    description: `Search the web for current information. Returns titles, URLs, and snippets.`,
    parameters: Type.Object({
      query: Type.String({ description: `The search query` }),
    }),
    execute: async (_toolCallId, params) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) {
        return textResult(
          `Web search unavailable: BRAVE_SEARCH_API_KEY not set. Respond based on your existing knowledge instead.`,
          { resultCount: 0 }
        )
      }

      const { query } = params as { query: string }
      const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=5`
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey },
      })
      if (!res.ok) {
        return textResult(`Search failed: ${res.status} ${res.statusText}`, {
          resultCount: 0,
        })
      }

      const data = (await res.json()) as {
        web?: {
          results?: Array<{ title: string; url: string; description: string }>
        }
      }
      const results = data.web?.results ?? []
      if (results.length === 0) {
        return textResult(`No results found for "${query}"`, {
          resultCount: 0,
        })
      }

      const formatted = results
        .map(
          (result, index) =>
            `${index + 1}. **${result.title}**\n   ${result.url}\n   ${result.description}`
        )
        .join(`\n\n`)
      return textResult(formatted, { resultCount: results.length })
    },
  }
}
```

Write to `examples/agents-chat-starter/src/server/shared-tools.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/server/shared-tools.ts
git commit -m "feat(agents-chat-starter): add shared agent tools"
```

---

### Task 4: Assistant Entity

**Files:**

- Create: `examples/agents-chat-starter/src/server/assistant.ts`

- [ ] **Step 1: Create assistant.ts**

The assistant is a general-purpose chat agent. It observes the chatroom shared state with wake-on-change, reads messages for context, and responds to general questions via `send_message`.

```typescript
import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createReadMessagesTool,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const ASSISTANT_MODEL = `claude-sonnet-4-5-20250929`

const assistantArgsSchema = z.object({
  chatroomId: z.string().min(1),
})

const ASSISTANT_SYSTEM_PROMPT = `You are a General Assistant in a shared chatroom with other agents and a human user.

Rules:
1. When the user asks a conversational question, needs help brainstorming, wants an explanation, or asks something that doesn't require web research, respond helpfully using the send_message tool.
2. If the question clearly requires current facts, news, or web research, stay silent — a Researcher agent will handle it. Do NOT call send_message in this case.
3. If you are unsure whether to respond, lean toward responding — it's better to help than to stay silent.
4. Always use read_messages first to understand the conversation context before responding.
5. Always use send_message to post your response — never respond without calling it.
6. Keep responses concise and helpful.
7. Do NOT respond to messages from other agents — only respond to user messages.`

export function registerAssistant(registry: EntityRegistry): void {
  registry.define(`assistant`, {
    description: `General-purpose helpful chat agent`,
    creationSchema: assistantArgsSchema,

    async handler(ctx) {
      const args = assistantArgsSchema.parse(ctx.args)
      const chatroom = (await ctx.observe(db(args.chatroomId, chatroomSchema), {
        wake: { on: `change`, collections: [`messages`] },
      })) as unknown as ChatroomState

      const agentName = `Assistant-` + ctx.entityUrl.split(`/`).pop()?.slice(-4)

      ctx.useAgent({
        systemPrompt: ASSISTANT_SYSTEM_PROMPT,
        model: ASSISTANT_MODEL,
        tools: [
          createReadMessagesTool(chatroom.messages),
          createSendMessageTool(chatroom.messages, ctx.entityUrl, agentName),
        ],
      })
      await ctx.agent.run()
    },
  })
}
```

Write to `examples/agents-chat-starter/src/server/assistant.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/server/assistant.ts
git commit -m "feat(agents-chat-starter): add assistant entity"
```

---

### Task 5: Researcher Entity

**Files:**

- Create: `examples/agents-chat-starter/src/server/researcher.ts`

- [ ] **Step 1: Create researcher.ts**

The researcher has `web_search` in addition to the shared tools. Its system prompt guides it to respond when factual research is needed.

```typescript
import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { chatroomSchema } from './schema.js'
import {
  createSendMessageTool,
  createReadMessagesTool,
  createWebSearchTool,
  type ChatroomState,
} from './shared-tools.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

const RESEARCHER_MODEL = `claude-sonnet-4-5-20250929`

const researcherArgsSchema = z.object({
  chatroomId: z.string().min(1),
})

const RESEARCHER_SYSTEM_PROMPT = `You are a Research Agent in a shared chatroom with other agents and a human user. You have access to web search.

Rules:
1. When the user asks a question that requires current facts, news, data, or web research, use web_search to find information, then respond using send_message.
2. If the question is general conversation, brainstorming, or an explanation that doesn't need current data, stay silent — a General Assistant will handle it. Do NOT call send_message in this case.
3. Always use read_messages first to understand the conversation context before responding.
4. Always use send_message to post your response — never respond without calling it.
5. When you search, synthesize the results into a clear, concise answer. Include relevant URLs.
6. Keep responses concise and informative.
7. Do NOT respond to messages from other agents — only respond to user messages.`

export function registerResearcher(registry: EntityRegistry): void {
  registry.define(`researcher`, {
    description: `Research agent with web search capability`,
    creationSchema: researcherArgsSchema,

    async handler(ctx) {
      const args = researcherArgsSchema.parse(ctx.args)
      const chatroom = (await ctx.observe(db(args.chatroomId, chatroomSchema), {
        wake: { on: `change`, collections: [`messages`] },
      })) as unknown as ChatroomState

      const agentName =
        `Researcher-` + ctx.entityUrl.split(`/`).pop()?.slice(-4)

      ctx.useAgent({
        systemPrompt: RESEARCHER_SYSTEM_PROMPT,
        model: RESEARCHER_MODEL,
        tools: [
          createReadMessagesTool(chatroom.messages),
          createSendMessageTool(chatroom.messages, ctx.entityUrl, agentName),
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}
```

Write to `examples/agents-chat-starter/src/server/researcher.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/server/researcher.ts
git commit -m "feat(agents-chat-starter): add researcher entity"
```

---

### Task 6: Backend Server

**Files:**

- Create: `examples/agents-chat-starter/src/server/index.ts`

This is the HTTP server that ties everything together: entity registration, room creation, user message writing, and agent spawning.

- [ ] **Step 1: Create index.ts**

```typescript
import path from 'node:path'

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
import { registerAssistant } from './assistant.js'
import { registerResearcher } from './researcher.js'

const DARIX_URL = process.env.DARIX_URL ?? `http://localhost:4437`
const PORT = Number(process.env.PORT ?? 4700)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()
registerAssistant(registry)
registerResearcher(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

// Track rooms: roomId -> { streamPath, agentCount }
const rooms = new Map<string, { streamPath: string; agentCount: number }>()

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

function extractRoomId(url: string): string | null {
  const match = url.match(/^\/api\/room\/([^/]+)/)
  return match ? match[1]! : null
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

  // Webhook handler for agents-runtime
  if (req.url === `/webhook` && req.method === `POST`) {
    await runtime.onEnter(req, res)
    return
  }

  // Return config for frontend
  if (req.url === `/api/config` && req.method === `GET`) {
    writeJson(res, 200, { darixUrl: DARIX_URL })
    return
  }

  // Create a new chatroom
  if (req.url === `/api/room` && req.method === `POST`) {
    try {
      const roomId = crypto.randomUUID().slice(0, 8)
      const streamPath = `/_electric/shared-state/${roomId}`

      // Create the shared state stream on the agents-server
      const putRes = await fetch(`${DARIX_URL}${streamPath}`, {
        method: `PUT`,
        headers: { 'Content-Type': `application/json` },
        body: `{}`,
      })
      if (!putRes.ok && putRes.status !== 409) {
        const text = await putRes.text()
        writeJson(res, 500, { error: `Failed to create room: ${text}` })
        return
      }

      rooms.set(roomId, { streamPath, agentCount: 0 })
      writeJson(res, 200, { roomId })
    } catch (err) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  // Send a user message to the chatroom
  const roomId = extractRoomId(req.url ?? ``)
  if (roomId && req.url?.endsWith(`/message`) && req.method === `POST`) {
    try {
      const body = (await readJson(req)) as { text?: string }
      if (!body.text) {
        writeJson(res, 400, { error: `Missing "text" field` })
        return
      }

      const room = rooms.get(roomId)
      if (!room) {
        writeJson(res, 404, { error: `Room not found` })
        return
      }

      // Append user message to the shared state stream
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

      const postRes = await fetch(`${DARIX_URL}${room.streamPath}`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify(event),
      })
      if (!postRes.ok) {
        const text = await postRes.text()
        writeJson(res, 500, { error: `Failed to send message: ${text}` })
        return
      }

      writeJson(res, 200, { ok: true })
    } catch (err) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  // Spawn an agent into a room
  if (roomId && req.url?.endsWith(`/agent`) && req.method === `POST`) {
    try {
      const body = (await readJson(req)) as { type?: string }
      if (!body.type) {
        writeJson(res, 400, { error: `Missing "type" field` })
        return
      }

      const room = rooms.get(roomId)
      if (!room) {
        writeJson(res, 404, { error: `Room not found` })
        return
      }

      room.agentCount++
      const agentId = `${roomId}-${body.type}-${room.agentCount}`

      const putRes = await fetch(`${DARIX_URL}/${body.type}/${agentId}`, {
        method: `PUT`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({
          args: { chatroomId: roomId },
          tags: { room_id: roomId },
        }),
      })

      if (!putRes.ok) {
        const text = await putRes.text()
        writeJson(res, 500, { error: `Spawn failed: ${text}` })
        return
      }

      writeJson(res, 200, {
        agentId,
        type: body.type,
        entityUrl: `/${body.type}/${agentId}`,
      })
    } catch (err) {
      writeJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`Chat server ready on port ${PORT}`)
  console.log(`DARIX: ${DARIX_URL}`)
  console.log(`${runtime.typeNames.length} entity types registered`)
})
```

Write to `examples/agents-chat-starter/src/server/index.ts`.

- [ ] **Step 2: Verify typecheck passes**

Run from `examples/agents-chat-starter/`:

```bash
pnpm install && pnpm typecheck
```

Expected: no type errors (or only minor ones to fix).

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(agents-chat-starter): add backend server with room/message/agent endpoints"
```

---

### Task 7: Frontend Hooks

**Files:**

- Create: `examples/agents-chat-starter/src/ui/hooks/useChatroom.ts`
- Create: `examples/agents-chat-starter/src/ui/hooks/useEntityTypes.ts`

- [ ] **Step 1: Create useChatroom.ts**

This hook subscribes to the chatroom shared state and tracks active agents. Follows the deep-survey `useSwarm` pattern.

```typescript
import { useState, useEffect } from 'react'
import { createAgentsClient, entities, db } from '@electric-ax/agents-runtime'
import { createEffect, type Collection } from '@tanstack/db'
import { chatroomSchema, type Message } from '../../server/schema.js'

interface EntityMember {
  url: string
  type: string
  status: string
  tags: Record<string, string>
  created_at: number
  updated_at: number
}

export interface ChatAgent {
  url: string
  name: string
  type: string
  status: string
}

function agentNameFromUrl(url: string): string {
  const parts = url.split(`/`).filter(Boolean)
  return parts[parts.length - 1] ?? url
}

export function useChatroom(darixUrl: string | null, roomId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!darixUrl || !roomId) return

    let cancelled = false
    const cleanups: Array<() => void> = []

    async function connect() {
      try {
        const client = createAgentsClient({ baseUrl: darixUrl! })

        // 1. Track agents in the room by tag
        const entitiesDb = await client.observe(
          entities({ tags: { room_id: roomId! } })
        )
        const members = (entitiesDb as any).collections
          .members as Collection<EntityMember>

        const agentMap = new Map<string, ChatAgent>()

        const entitiesEffect = createEffect({
          query: (q) => q.from({ m: members }),
          onEnter: (event) => {
            const m = event.value as unknown as EntityMember
            agentMap.set(m.url, {
              url: m.url,
              name: agentNameFromUrl(m.url),
              type: m.type,
              status: m.status,
            })
            if (!cancelled) setAgents(Array.from(agentMap.values()))
          },
          onUpdate: (event) => {
            const m = event.value as unknown as EntityMember
            const existing = agentMap.get(m.url)
            if (existing) {
              existing.status = m.status
              if (!cancelled) setAgents(Array.from(agentMap.values()))
            }
          },
        })
        cleanups.push(() => entitiesEffect.dispose())

        // 2. Subscribe to chatroom shared state messages
        const chatroomDb = await client.observe(db(roomId!, chatroomSchema))
        const messagesCollection = (chatroomDb as any).collections
          .messages as Collection<Message>

        const messagesEffect = createEffect({
          query: (q) => q.from({ m: messagesCollection }),
          onEnter: () => {
            const all = Array.from(messagesCollection.values()) as Message[]
            const sorted = all.sort((a, b) => a.timestamp - b.timestamp)
            if (!cancelled) setMessages(sorted)
          },
          onUpdate: () => {
            const all = Array.from(messagesCollection.values()) as Message[]
            const sorted = all.sort((a, b) => a.timestamp - b.timestamp)
            if (!cancelled) setMessages(sorted)
          },
        })
        cleanups.push(() => messagesEffect.dispose())

        if (!cancelled) {
          setConnected(true)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setConnected(false)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [darixUrl, roomId])

  return { messages, agents, connected, error }
}
```

Write to `examples/agents-chat-starter/src/ui/hooks/useChatroom.ts`.

- [ ] **Step 2: Create useEntityTypes.ts**

Fetches available entity types from the agents-server registry.

```typescript
import { useState, useEffect } from 'react'

export interface EntityType {
  name: string
  description: string
}

export function useEntityTypes(darixUrl: string | null) {
  const [types, setTypes] = useState<EntityType[]>([])

  useEffect(() => {
    if (!darixUrl) return

    fetch(`${darixUrl}/_electric/entity-types`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setTypes(data as EntityType[]))
      .catch((err) => console.error(`Failed to load entity types:`, err))
  }, [darixUrl])

  return types
}
```

Write to `examples/agents-chat-starter/src/ui/hooks/useEntityTypes.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/hooks/useChatroom.ts src/ui/hooks/useEntityTypes.ts
git commit -m "feat(agents-chat-starter): add useChatroom and useEntityTypes hooks"
```

---

### Task 8: Frontend Components

**Files:**

- Create: `examples/agents-chat-starter/src/ui/components/MessageBubble.tsx`
- Create: `examples/agents-chat-starter/src/ui/components/AgentBar.tsx`
- Create: `examples/agents-chat-starter/src/ui/components/ChatRoom.tsx`

- [ ] **Step 1: Create MessageBubble.tsx**

Renders a single chat message. User messages are right-aligned, agent messages left-aligned with a colored type badge.

```tsx
import type { Message } from '../../server/schema.js'

const TYPE_COLORS: Record<string, string> = {
  researcher: `#3b82f6`,
  assistant: `#10b981`,
}

function agentTypeFromName(name: string): string {
  if (name.toLowerCase().startsWith(`researcher`)) return `researcher`
  if (name.toLowerCase().startsWith(`assistant`)) return `assistant`
  return `agent`
}

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === `user`
  const agentType = isUser ? `` : agentTypeFromName(message.senderName)
  const dotColor = TYPE_COLORS[agentType] ?? `#6b7280`

  return (
    <div className={`message ${isUser ? `message-user` : `message-agent`}`}>
      {!isUser && (
        <div className="message-header">
          <span className="agent-dot" style={{ backgroundColor: dotColor }} />
          <span className="agent-name">{message.senderName}</span>
        </div>
      )}
      <div className="message-text">{message.text}</div>
    </div>
  )
}
```

Write to `examples/agents-chat-starter/src/ui/components/MessageBubble.tsx`.

- [ ] **Step 2: Create AgentBar.tsx**

Shows active agents in the room and dynamic "Add" buttons from the entity type registry.

```tsx
import type { ChatAgent } from '../hooks/useChatroom.js'
import type { EntityType } from '../hooks/useEntityTypes.js'

const STATUS_COLORS: Record<string, string> = {
  running: `#f59e0b`,
  idle: `#10b981`,
  stopped: `#6b7280`,
  spawning: `#8b5cf6`,
}

export function AgentBar({
  agents,
  entityTypes,
  onSpawn,
  spawning,
}: {
  agents: ChatAgent[]
  entityTypes: EntityType[]
  onSpawn: (type: string) => void
  spawning: boolean
}) {
  return (
    <div className="agent-bar">
      <div className="agent-bar-agents">
        {agents.length === 0 && (
          <span className="agent-bar-empty">No agents yet</span>
        )}
        {agents.map((agent) => (
          <span key={agent.url} className="agent-tag">
            <span
              className="agent-dot"
              style={{
                backgroundColor: STATUS_COLORS[agent.status] ?? `#6b7280`,
              }}
            />
            {agent.name}
          </span>
        ))}
      </div>
      <div className="agent-bar-actions">
        {entityTypes.map((et) => (
          <button
            key={et.name}
            className="btn btn-spawn"
            onClick={() => onSpawn(et.name)}
            disabled={spawning}
            title={et.description}
          >
            + {et.name}
          </button>
        ))}
      </div>
    </div>
  )
}
```

Write to `examples/agents-chat-starter/src/ui/components/AgentBar.tsx`.

- [ ] **Step 3: Create ChatRoom.tsx**

Main chat view: scrollable message list + input box.

```tsx
import { useState, useRef, useEffect } from 'react'
import type { Message } from '../../server/schema.js'
import { MessageBubble } from './MessageBubble.js'

export function ChatRoom({
  messages,
  onSend,
}: {
  messages: Message[]
  onSend: (text: string) => void
}) {
  const [input, setInput] = useState(``)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: `smooth` })
  }, [messages.length])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput(``)
    setSending(true)
    try {
      onSend(text)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chatroom">
      <div className="messages">
        {messages.length === 0 && (
          <div className="messages-empty">
            Add some agents and start chatting!
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.key} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="input-bar">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === `Enter` && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Type a message..."
          className="input-text"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="btn btn-send"
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

Write to `examples/agents-chat-starter/src/ui/components/ChatRoom.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/MessageBubble.tsx src/ui/components/AgentBar.tsx src/ui/components/ChatRoom.tsx
git commit -m "feat(agents-chat-starter): add chat UI components"
```

---

### Task 9: App Entry and Styles

**Files:**

- Create: `examples/agents-chat-starter/src/ui/main.tsx`
- Create: `examples/agents-chat-starter/src/ui/main.css`

- [ ] **Step 1: Create main.css**

Minimal, clean chat app styles. Dark theme consistent with deep-survey aesthetic.

```css
:root {
  --bg: #0f0f0f;
  --bg-surface: #1a1a1a;
  --bg-hover: #252525;
  --border: #2a2a2a;
  --text: #e5e5e5;
  --text-muted: #737373;
  --accent-blue: #3b82f6;
  --accent-green: #10b981;
  --accent-orange: #f59e0b;
  --font: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font);
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
}

.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
}

.header-title {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.header-room {
  color: var(--text-muted);
}

.header-status {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.status-dot.connected {
  background: var(--accent-green);
}

.status-dot.disconnected {
  background: #ef4444;
}

/* Agent Bar */
.agent-bar {
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.agent-bar-agents {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.agent-bar-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.agent-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 3px;
}

.agent-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.agent-bar-actions {
  display: flex;
  gap: 6px;
}

/* Buttons */
.btn {
  padding: 4px 10px;
  font-family: var(--font);
  font-size: 11px;
  border: 1px solid var(--border);
  background: var(--bg-surface);
  color: var(--text);
  cursor: pointer;
  border-radius: 3px;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.btn-spawn {
  font-weight: 600;
  text-transform: capitalize;
}

.btn-send {
  background: var(--accent-blue);
  border-color: var(--accent-blue);
  color: white;
  font-weight: 600;
  padding: 8px 16px;
}

.btn-send:hover:not(:disabled) {
  opacity: 0.9;
  background: var(--accent-blue);
}

/* Chat Room */
.chatroom {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.messages-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 12px;
}

/* Messages */
.message {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.5;
}

.message-user {
  align-self: flex-end;
  background: var(--accent-blue);
  color: white;
}

.message-agent {
  align-self: flex-start;
  background: var(--bg-surface);
  border: 1px solid var(--border);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
  font-weight: 600;
}

.agent-name {
  color: var(--text-muted);
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Input Bar */
.input-bar {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
}

.input-text {
  flex: 1;
  padding: 8px 12px;
  font-family: var(--font);
  font-size: 13px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 4px;
  outline: none;
}

.input-text:focus {
  border-color: var(--accent-blue);
}

.input-text::placeholder {
  color: var(--text-muted);
}

/* Splash Screen */
.splash {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.splash-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
}

.splash-sub {
  color: var(--text-muted);
  font-size: 11px;
}

.splash-error {
  color: #ef4444;
  font-size: 11px;
}
```

Write to `examples/agents-chat-starter/src/ui/main.css`.

- [ ] **Step 2: Create main.tsx**

App entry point. Manages room lifecycle: create room, connect, send messages, spawn agents.

```tsx
import { StrictMode, useState, useCallback, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useChatroom } from './hooks/useChatroom.js'
import { useEntityTypes } from './hooks/useEntityTypes.js'
import { ChatRoom } from './components/ChatRoom.js'
import { AgentBar } from './components/AgentBar.js'
import './main.css'

function getRoomFromHash(): string | null {
  const hash = window.location.hash.slice(1)
  return hash || null
}

function App() {
  const [config, setConfig] = useState<{ darixUrl: string } | null>(null)
  const [roomId, setRoomId] = useState<string | null>(getRoomFromHash)
  const [creating, setCreating] = useState(false)
  const [spawning, setSpawning] = useState(false)
  const [appError, setAppError] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setRoomId(getRoomFromHash())
    window.addEventListener(`hashchange`, onHashChange)
    return () => window.removeEventListener(`hashchange`, onHashChange)
  }, [])

  useEffect(() => {
    fetch(`/api/config`)
      .then((r) => {
        if (!r.ok) throw new Error(`Config endpoint returned ${r.status}`)
        return r.json()
      })
      .then((c) => setConfig(c as { darixUrl: string }))
      .catch((err) => {
        setAppError(
          `Failed to connect: ${err instanceof Error ? err.message : String(err)}`
        )
      })
  }, [])

  const { messages, agents, connected, error } = useChatroom(
    config?.darixUrl ?? null,
    roomId
  )
  const entityTypes = useEntityTypes(config?.darixUrl ?? null)

  const createRoom = useCallback(async () => {
    setCreating(true)
    setAppError(null)
    try {
      const res = await fetch(`/api/room`, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: `{}`,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`
        )
      }
      const data = (await res.json()) as { roomId: string }
      window.location.hash = data.roomId
      setRoomId(data.roomId)
    } catch (err) {
      setAppError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!roomId) return
      try {
        const res = await fetch(`/api/room/${roomId}/message`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({ text }),
        })
        if (!res.ok) {
          console.error(`Send failed: HTTP ${res.status}`)
        }
      } catch (err) {
        console.error(`Send failed:`, err)
      }
    },
    [roomId]
  )

  const spawnAgent = useCallback(
    async (type: string) => {
      if (!roomId) return
      setSpawning(true)
      try {
        const res = await fetch(`/api/room/${roomId}/agent`, {
          method: `POST`,
          headers: { 'Content-Type': `application/json` },
          body: JSON.stringify({ type }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          console.error(
            `Spawn failed:`,
            (body as { error?: string }).error ?? `HTTP ${res.status}`
          )
        }
      } catch (err) {
        console.error(`Spawn failed:`, err)
      } finally {
        setSpawning(false)
      }
    },
    [roomId]
  )

  // Loading state
  if (!config) {
    return (
      <div className="splash">
        <div className="splash-title">ELECTRIC AGENTS CHAT</div>
        <div className="splash-sub">connecting...</div>
        {appError && <div className="splash-error">{appError}</div>}
      </div>
    )
  }

  // No room — show create button
  if (!roomId) {
    return (
      <div className="splash">
        <div className="splash-title">ELECTRIC AGENTS CHAT</div>
        <div className="splash-sub">
          Create a chatroom and add AI agents to chat with
        </div>
        <button
          className="btn btn-send"
          onClick={createRoom}
          disabled={creating}
        >
          {creating ? `Creating...` : `Create Room`}
        </button>
        {appError && <div className="splash-error">{appError}</div>}
      </div>
    )
  }

  // Active room
  return (
    <div className="app">
      <div className="header">
        <span className="header-title">ELECTRIC AGENTS CHAT</span>
        <span className="header-room">Room: {roomId}</span>
        <div className="header-status">
          <span
            className={`status-dot ${connected ? `connected` : `disconnected`}`}
          />
          <span>{connected ? `connected` : `connecting...`}</span>
        </div>
      </div>
      <AgentBar
        agents={agents}
        entityTypes={entityTypes}
        onSpawn={spawnAgent}
        spawning={spawning}
      />
      {error && (
        <div style={{ padding: `8px 16px`, color: `#ef4444`, fontSize: 11 }}>
          {error}
        </div>
      )}
      <ChatRoom messages={messages} onSend={sendMessage} />
    </div>
  )
}

createRoot(document.getElementById(`root`)!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

Write to `examples/agents-chat-starter/src/ui/main.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/main.tsx src/ui/main.css
git commit -m "feat(agents-chat-starter): add app entry point and styles"
```

---

### Task 10: Typecheck and Verify

- [ ] **Step 1: Install dependencies**

From repo root:

```bash
pnpm install
```

- [ ] **Step 2: Run typecheck**

```bash
cd examples/agents-chat-starter && pnpm typecheck
```

Expected: passes with no errors. If there are type errors, fix them before proceeding.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(agents-chat-starter): fix type errors"
```

---

### Task 11: End-to-End Manual Test

This task verifies the full flow works against real infrastructure.

- [ ] **Step 1: Start infrastructure**

```bash
npx electric-ax agent quickstart
```

Wait for Postgres, Electric, and agents-server to be ready.

- [ ] **Step 2: Start the app**

From `examples/agents-chat-starter/`:

```bash
pnpm dev
```

This starts both the backend server (port 4700) and Vite dev server (port 5175).

- [ ] **Step 3: Verify the flow**

Open http://localhost:5175 in a browser:

1. Click "Create Room" — should get a room ID in the URL hash
2. Click "+ assistant" — should see an agent tag appear in the agent bar
3. Click "+ researcher" — should see a second agent tag
4. Type "Hello, who are you?" and press Enter
5. The message should appear in the chat
6. Within a few seconds, the assistant should respond via the shared state
7. Type "What's the latest news about TypeScript?" and press Enter
8. The researcher should pick this up and respond with web search results (if BRAVE_SEARCH_API_KEY is set)

- [ ] **Step 4: Verify dynamic entity discovery**

Check that the entity type buttons in the agent bar match the registered types by visiting:

```bash
curl http://localhost:4437/_electric/entity-types
```

Should return JSON array with `assistant` and `researcher` entries.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(agents-chat-starter): complete starter project"
```
