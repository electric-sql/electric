---
description: Guided quickstart — build a full Electric Agents app from entity to frontend
whenToUse: User is new to Electric Agents, wants to learn how agents work, asks for a quickstart or getting started guide
keywords:
  - quickstart
  - getting started
  - learn
  - multi-agent
  - manager-worker
  - entity
  - app
  - frontend
user-invocable: true
max: 35000
---

# Quickstart: Build a Perspectives Analyzer

Build a `perspectives` entity that analyzes questions from an optimist and a critic using the manager-worker pattern. Use the exact code below — do not invent different code.

## Core Concepts

### What is Electric Agents?

Electric Agents is a runtime for spawning and orchestrating collaborative AI agents on serverless compute.

The core idea: agent sessions and communication are backed by **durable streams**. Each agent is an **entity** with its own stream of events. All agent activity — runs, tool calls, text output — is persisted to this stream. This means agents can scale to zero, survive restarts, and maintain full session history.

**Why this matters for multi-agent systems**: Because everything is durable and observable, agents can spawn children, wait for results (even across restarts), observe each other's state changes, and coordinate through structured primitives — all without worrying about losing state.

### Entities

An entity is a durable, addressable unit of computation. Each entity has:

- A **type** (e.g., `assistant`, `worker`, `research-team`) — defined once, instantiated many times
- A **URL** (e.g., `/research-team/my-team`) — its unique address
- A **handler** — the function that runs each time the entity wakes up
- **State** — persistent collections that survive across wakes

You define entity types with `registry.define()` and create instances by spawning them.

### Handlers and Wakes

An entity's handler runs in response to **wake events**:

- A message arrives in the entity's inbox
- A child entity finishes its run
- A cron schedule fires
- A state change in an observed entity

The handler is **not** a long-running process. It wakes, does its work (usually running an LLM agent loop), and goes back to sleep.

### The Agent Loop

`ctx.useAgent()` configures an LLM agent and `ctx.agent.run()` starts it. The agent receives conversation history, calls tools as needed, and generates a response — all persisted to the entity's durable stream.

### Spawning Children

Any entity can spawn child entities. When a child finishes (and the parent registered `wake: "runFinished"`), the parent's handler runs again. The wake event includes the child's response and the status of sibling children.

### The Worker Entity

The built-in `worker` type is a generic agent substrate. You configure it at spawn time with a `systemPrompt` and `tools` array (at least one tool required).

### State Collections

Entities can declare persistent state collections that survive across wakes, allowing coordination patterns like tracking which children have completed.

## Before starting

**Ask the user where they want the project.** Suggest a sensible default (e.g., `./perspectives-app` relative to the working directory) but let them choose. Do not create files or directories until the user confirms the location.

**Ensure the user has an `ANTHROPIC_API_KEY` set.** The app's `.env` file (in the project root) must contain `ANTHROPIC_API_KEY=sk-ant-...`. If there is no `.env` file yet, ask the user to create one or provide their key so you can write it. Without this key, agents cannot call the LLM and will fail at runtime.

Once the directory is confirmed, read `server.ts` in that directory:

- **Has `registerPerspectives`**: resume from where they left off (read `entities/perspectives.ts` to determine the step)
- **Has `server.ts` but no perspectives**: go to Step 1
- **No `server.ts`**: scaffold the project — spawn a worker (`tools: ["bash"]`, systemPrompt: `"Set up an Electric Agents app project."`, initialMessage: `"mkdir -p TARGET/lib TARGET/entities && cp SKILL_DIR/scaffold/* TARGET/ && cp SKILL_DIR/scaffold/lib/* TARGET/lib/ && cd TARGET && pnpm install && pnpm dev &"` — replace SKILL_DIR and TARGET). Then proceed to Step 1 while the worker runs. Wait for the worker to finish before writing files.

## Steps

**Step 1 — Welcome + first entity.** In one message: introduce Electric Agents using the Core Concepts above, preview the perspectives analyzer, and show the Step 1 code. Ask to write.

**Step 2 — After confirmation:** write `entities/perspectives.ts` with Step 1 code. Give CLI commands. Explain spawning briefly, show Step 2 code (adds one worker). Ask to write.

**Step 3 — After confirmation:** write the updated file. Give CLI commands. Explain coordination, show Step 3 code (adds critic + state). Ask to write.

**Step 4 — After confirmation:** write the updated file. Give CLI commands.

**Step 5 — Wire up.** Read `server.ts`, show the import change, ask to write, update it.

**Step 6 — After confirmation:** explain shared state as cross-entity coordination. Show Step 6 code (chatroom schema + chat-agent entity with `ctx.mkdb` and `ctx.observe`). Write files, give CLI commands to test. Ask to continue.

**Step 7 — After confirmation:** explain context assembly. Show the `ctx.useContext()` addition. Update the entity file. Test with two agents in the same room. Ask to continue.

**Step 8 — After confirmation:** explain live frontend queries. Show Step 8 code (React + TanStack DB `useLiveQuery`). Create UI files, add deps, give commands to run. Show how updates appear in real time.

**Step 9 — Recap.**

## Rules

- Use the exact code below. Write files with your write tool.
- `server.ts` is at the working directory root. Entity files go in `entities/`.
- Worker spawn args MUST include `tools` array (e.g. `tools: ["bash", "read"]`).
- Prefer showing what changed between steps rather than repeating the entire file.
- Use `edit` tool for small changes (like updating server.ts). Use `write` for full entity file updates.
- If the user asks a question about Electric Agents concepts, APIs, or patterns between steps, use the `search_durable_agents_docs` tool to look up the answer in the built-in documentation before guessing or searching the web.

---

# Code

## Step 1: Minimal entity

`entities/perspectives.ts`:

```typescript
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description: 'Analyzes questions from multiple perspectives',
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt:
          'You are a balanced analyst. When given a question, provide a thoughtful analysis.',
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools],
      })
      await ctx.agent.run()
    },
  })
}
```

`server.ts` additions:

```typescript
import { registerPerspectives } from './entities/perspectives'
registerPerspectives(registry)
```

Test: `pnpm electric-agents spawn /perspectives/test-1 && pnpm electric-agents send /perspectives/test-1 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-1`

## Step 2: One worker

Full `entities/perspectives.ts`:

```typescript
import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

function createAnalyzeTool(ctx: HandlerContext) {
  return {
    name: 'analyze_question',
    label: 'Analyze Question',
    description: 'Spawns an optimist worker to analyze a question.',
    parameters: Type.Object({
      question: Type.String({ description: 'The question to analyze' }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question } = params as { question: string }
      const parentId = ctx.entityUrl.split('/').pop()
      await ctx.spawn(
        'worker',
        `${parentId}-optimist`,
        {
          systemPrompt:
            'You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities and benefits.',
          tools: ['bash', 'read'],
        },
        { initialMessage: question, wake: 'runFinished' }
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: "Spawned optimist worker. You'll be woken when it finishes.",
          },
        ],
        details: {},
      }
    },
  }
}

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description: 'Analyzes questions from multiple perspectives',
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: `You are a balanced analyst.\n\nWhen given a question:\n1. Call analyze_question with the question.\n2. End your turn. You'll be woken when the worker finishes.\n3. When woken, finished_child.response contains the analysis.\n4. Present it to the user.`,
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools, createAnalyzeTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

Test: `pnpm electric-agents spawn /perspectives/test-2 && pnpm electric-agents send /perspectives/test-2 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-2`

## Step 3: Two workers + state

Full `entities/perspectives.ts`:

```typescript
import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

const PERSPECTIVES = [
  {
    id: 'optimist',
    systemPrompt:
      'You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities and benefits.',
  },
  {
    id: 'critic',
    systemPrompt:
      'You are a critical analyst. Provide a sharp analysis focusing on risks, downsides, and challenges.',
  },
]

function createAnalyzeTool(ctx: HandlerContext) {
  return {
    name: 'analyze_question',
    label: 'Analyze Question',
    description: 'Spawns optimist and critic workers to analyze a question.',
    parameters: Type.Object({
      question: Type.String({ description: 'The question to analyze' }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question } = params as { question: string }
      const parentId = ctx.entityUrl.split('/').pop()
      for (const p of PERSPECTIVES) {
        const childId = `${parentId}-${p.id}`
        await ctx.spawn(
          'worker',
          childId,
          { systemPrompt: p.systemPrompt, tools: ['bash', 'read'] },
          { initialMessage: question, wake: 'runFinished' }
        )
        ctx.db.actions.children_insert({
          row: { key: p.id, url: `/worker/${childId}` },
        })
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Spawned optimist and critic workers.',
          },
        ],
        details: {},
      }
    },
  }
}

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description:
      'Analyzes questions from two perspectives: optimist and critic',
    state: { children: { primaryKey: 'key' } },
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: `You are a balanced analyst.\n\n1. Call analyze_question with the question.\n2. End your turn. You'll be woken as each worker finishes.\n3. Each wake includes finished_child.response and other_children.\n4. Once both are done, synthesize a balanced response.`,
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools, createAnalyzeTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

Test: `pnpm electric-agents spawn /perspectives/test-3 && pnpm electric-agents send /perspectives/test-3 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-3`

## Step 6: Shared state — a chatroom

In the perspectives analyzer, workers reported back to a parent via `runFinished`. But what if agents need to coordinate in real time — reading and writing to the same data? That's **shared state**.

Shared state is a durable stream that multiple entities can observe. One entity creates it with `ctx.mkdb()`, others connect with `ctx.observe(db(...))`. Both sides read and write the same collections.

Let's build a chatroom: a shared message log that agents post to using a `send_message` tool.

`entities/chatroom-schema.ts`:

```typescript
import { z } from 'zod'

export const messageSchema = z.object({
  key: z.string().min(1),
  role: z.enum(['user', 'agent']),
  sender: z.string().min(1),
  senderName: z.string().min(1),
  text: z.string().min(1),
  timestamp: z.number(),
})

export const chatroomSchema = {
  messages: {
    schema: messageSchema,
    type: 'shared:message',
    primaryKey: 'key',
  },
} as const
```

`entities/chat-agent.ts`:

```typescript
import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { Type } from '@sinclair/typebox'
import { chatroomSchema } from './chatroom-schema'
import type {
  EntityRegistry,
  SharedStateHandle,
  AgentTool,
} from '@electric-ax/agents-runtime'

type ChatroomState = SharedStateHandle<typeof chatroomSchema>

const chatAgentArgs = z.object({ chatroomId: z.string().min(1) })

function createSendMessageTool(
  messages: ChatroomState['messages'],
  senderName: string
): AgentTool {
  return {
    name: 'send_message',
    description: 'Post a message to the chatroom.',
    parameters: Type.Object({
      text: Type.String({ description: 'The message text' }),
    }),
    execute: async (_id, params) => {
      const { text } = params as { text: string }
      ;(messages as any).insert({
        key: crypto.randomUUID(),
        role: 'agent',
        sender: senderName,
        senderName,
        text,
        timestamp: Date.now(),
      })
      return {
        content: [{ type: 'text' as const, text: 'Message sent.' }],
        details: {},
      }
    },
  }
}

function createWebSearchTool(): AgentTool {
  return {
    name: 'web_search',
    description: 'Search the web for current information.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query' }),
    }),
    execute: async (_id, params) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Web search unavailable: BRAVE_SEARCH_API_KEY not set.',
            },
          ],
          details: {},
        }
      }
      const { query } = params as { query: string }
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        { headers: { 'X-Subscription-Token': apiKey } }
      )
      if (!res.ok) {
        return {
          content: [
            { type: 'text' as const, text: `Search failed: ${res.status}` },
          ],
          details: {},
        }
      }
      const data = (await res.json()) as {
        web?: {
          results?: Array<{ title: string; url: string; description: string }>
        }
      }
      const results = data.web?.results ?? []
      const formatted = results
        .map(
          (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`
        )
        .join('\n\n')
      return {
        content: [
          { type: 'text' as const, text: formatted || 'No results found.' },
        ],
        details: { resultCount: results.length },
      }
    },
  }
}

export function registerChatAgent(registry: EntityRegistry) {
  registry.define('chat-agent', {
    description: 'Chat agent that reads and writes to a shared chatroom',
    creationSchema: chatAgentArgs,
    async handler(ctx) {
      const args = chatAgentArgs.parse(ctx.args)

      // First wake: create the shared state
      if (ctx.firstWake) {
        ctx.mkdb(args.chatroomId, chatroomSchema)
      }

      // Observe shared state — wake when messages change
      const chatroom = (await ctx.observe(db(args.chatroomId, chatroomSchema), {
        wake: { on: 'change', collections: ['shared:message'] },
      })) as unknown as ChatroomState

      // On first wake, just register the wake — don't call the LLM
      if (ctx.firstWake) return

      ctx.useAgent({
        systemPrompt:
          'You are a helpful chat agent. Use web_search to find information and send_message to reply.',
        model: 'claude-sonnet-4-6',
        tools: [
          createSendMessageTool(chatroom.messages, ctx.entityUrl),
          createWebSearchTool(),
        ],
      })
      await ctx.agent.run()
    },
  })
}
```

Add to `server.ts`:

```typescript
import { registerChatAgent } from './entities/chat-agent'
registerChatAgent(registry)
```

Test:

```bash
pnpm electric-agents spawn /chat-agent/agent-1 '{"chatroomId":"room-1"}' \
  && pnpm electric-agents send /chat-agent/agent-1 "Hello! What can you help me with?" \
  && pnpm electric-agents observe /chat-agent/agent-1
```

**Key concepts:**

- `ctx.mkdb(id, schema)` — creates a shared state stream (only on first wake)
- `ctx.observe(db(id, schema), { wake })` — connects to shared state and wakes on changes
- `wake: { on: 'change', collections: ['shared:message'] }` — wake when specific event types appear
- The observe + wake must run on first wake (before early return) so the wake registers
- Custom tools (`send_message`, `web_search`) — agents interact with the world through tools you define

## Step 7: Context assembly — agents that remember

When an agent wakes, it only sees the current message in its inbox. But in a chatroom, it needs the full conversation history to respond intelligently. And if a new agent joins mid-conversation, it should catch up.

`ctx.useContext()` injects external data into the agent's context before the LLM call. You configure sources with a token budget and cache strategy:

Update the handler in `entities/chat-agent.ts` — add `useContext` between `observe` and `useAgent`:

```typescript
      // Read conversation history from shared state
      const allMessages = (chatroom.messages as any).toArray as Array<{
        senderName: string
        text: string
      }>
      const history = allMessages
        .map((m) => `[${m.senderName}]: ${m.text}`)
        .join('\n')

      // Inject as volatile context (changes every wake)
      ctx.useContext({
        sourceBudget: 50_000,
        sources: {
          conversation: {
            cache: 'volatile',
            content: async () =>
              history ? `Conversation so far:\n${history}` : '',
          },
        },
      })

      ctx.useAgent({
```

Test — spawn two agents in the same room to see them share context:

```bash
pnpm electric-agents spawn /chat-agent/agent-2 '{"chatroomId":"room-1"}' \
  && pnpm electric-agents send /chat-agent/agent-2 "What has been discussed so far?" \
  && pnpm electric-agents observe /chat-agent/agent-2
```

Agent 2 sees agent 1's messages because both observe the same shared state.

**Key concepts:**

- `ctx.useContext()` — injects data into the LLM context (separate from the system prompt)
- `sourceBudget` — limits total tokens so long conversations don't overflow
- `cache: 'volatile'` — content changes every wake (vs `'stable'` for static docs, `'pinned'` for always-include)
- The content function is `async` — you can fetch from any source

## Step 8: Frontend — live queries

The agents are chatting, but we can't see it. Let's build a frontend that subscribes to the shared state and updates in real time — no polling.

The frontend uses `createAgentsClient` to connect to the agents server, then `useLiveQuery` from TanStack DB for reactive queries on durable stream collections.

`ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`ui/main.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { createAgentsClient, db } from '@electric-ax/agents-runtime'
import { useLiveQuery } from '@tanstack/react-db'
import type { Collection } from '@tanstack/db'
import { chatroomSchema } from '../entities/chatroom-schema'

const AGENTS_URL = 'http://localhost:4437'
const ROOM_ID = 'room-1'

function Chat() {
  const [collection, setCollection] = useState<Collection<any> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const client = createAgentsClient({ baseUrl: AGENTS_URL })
    client
      .observe(db(ROOM_ID, chatroomSchema))
      .then((sdb: any) => setCollection(sdb.collections.messages))
      .catch((e: Error) => setError(e.message))
  }, [])

  const { data: messages = [] } = useLiveQuery(
    collection
      ? (q) =>
          q
            .from({ m: collection })
            .orderBy(({ m }) => (m as any).timestamp, 'asc')
            .select(({ m }) => m)
      : () => null,
    [collection]
  )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (error) return <div>Error: {error}</div>
  if (!collection) return <div>Connecting...</div>

  return (
    <div
      style={{ maxWidth: 600, margin: '2rem auto', fontFamily: 'system-ui' }}
    >
      <h1>Chatroom: {ROOM_ID}</h1>
      <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          minHeight: 300,
        }}
      >
        {messages.map((m: any) => (
          <div key={m.key} style={{ marginBottom: 8 }}>
            <strong>{m.senderName}:</strong> {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Chat />)
```

Add dependencies: `pnpm add @tanstack/db @tanstack/react-db react react-dom` and dev dependencies: `pnpm add -D @types/react @types/react-dom @vitejs/plugin-react vite`

Add a Vite config (`vite.config.ts`):

```typescript
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  resolve: {
    alias: {
      '@tanstack/db': path.resolve(
        import.meta.dirname,
        'node_modules/@tanstack/db'
      ),
    },
  },
  server: { port: 5175 },
  build: { outDir: '../dist', emptyOutDir: true },
})
```

Run: `npx vite` (in a new terminal). Open `http://localhost:5175`.

Then send a message to an agent in the room:

```bash
pnpm electric-agents send /chat-agent/agent-1 "What's the weather like today?"
```

Watch the frontend update in real time as the agent responds.

**Key concepts:**

- `createAgentsClient({ baseUrl })` — connects the frontend to the agents server
- `client.observe(db(roomId, schema))` — subscribes to a shared state stream (SSE)
- `useLiveQuery` — reactive query that re-renders when the collection changes
- `.select(({ m }) => m)` — flattens the query result (removes the alias wrapper)
- No polling — the durable stream pushes updates to the browser via SSE

## What you learned

| Step | Concept                 | API                                                             |
| ---- | ----------------------- | --------------------------------------------------------------- |
| 1    | Entity types & handlers | `registry.define()`, `ctx.useAgent()`, `ctx.agent.run()`        |
| 2    | Spawning children       | `ctx.spawn()`, `wake: 'runFinished'`                            |
| 3    | State collections       | `state: { children: { primaryKey: 'key' } }`                    |
| 6    | Shared state            | `ctx.mkdb()`, `ctx.observe(db(...))`, cross-entity coordination |
| 7    | Context assembly        | `ctx.useContext()`, `sourceBudget`, cache tiers                 |
| 8    | Live frontend           | `createAgentsClient`, `useLiveQuery`, `.select()`               |

For a complete multi-agent chat app with rooms, agent spawning, and a Slack-style UI, see the [agents-chat-starter](https://github.com/electric-sql/electric/tree/main/examples/agents-chat-starter) example.
