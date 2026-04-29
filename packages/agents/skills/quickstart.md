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
- **No `server.ts`**: scaffold the project — spawn a worker (`tools: ["bash"]`, systemPrompt: `"Set up an Electric Agents app project."`, initialMessage: `"cp -r SKILL_DIR/scaffold/. TARGET/ && cd TARGET && npm install && npm run dev &"` — replace SKILL_DIR and TARGET). While the worker runs, proceed to Step 1 (explain concepts + show code). Wait for the worker to finish AND for user confirmation before writing any files.

When the scaffold finishes, explain to the user:

- The scaffold created a basic Electric Agents app with a `server.ts` that registers entity types, connects to the agent server, and listens for webhook callbacks on port 3000.
- `npm run dev` started the server in the background with `tsx --watch`, so any file changes will auto-reload.
- The `entities/` directory is where we'll add our agent code — it's empty for now.
- The server is already connected to the Electric Agents coordinator (on port 4437) and ready to handle entities once we define them.
- `server.ts` is a plain Node.js HTTP server — you can add your own routes, middleware, or serve a frontend from it. We'll do exactly that in later steps.

## Steps

IMPORTANT: Never write files until the user explicitly confirms. "Ask to write" means show the code, then wait for the user to say yes. Do not write files automatically after scaffolding completes or after showing code.

**Step 1 — Welcome + first entity.** In one message: introduce Electric Agents using the Core Concepts above, preview the perspectives analyzer, and show the Step 1 code. Ask the user if they want you to write it. Do NOT write until they confirm.

**Step 2 — After confirmation:** write `entities/perspectives.ts` with Step 1 code. Also update `server.ts` to import and register the entity (replace the placeholder comments with `import { registerPerspectives } from './entities/perspectives'` and `registerPerspectives(registry)`). Give CLI commands. Explain spawning briefly, show Step 2 code (adds one worker). Ask to write.

**Step 3 — After confirmation:** write the updated file. Give CLI commands. Explain coordination, show Step 3 code (adds critic + state). Ask to write. After confirmation, write the file and encourage the user to try the CLI commands.

**Checkpoint.** After Step 3 is confirmed and working, congratulate the user: they have a working multi-agent system with a manager that spawns workers and synthesizes results. Recap what they've built so far (entity, spawning, state coordination). Then present options for what to do next:

- **Continue building** — add an HTTP API route and a React frontend to this app so users can interact with the analyzer from the browser.
- **Start a new app** — use the `agents-chat-starter` template for a full multi-agent chat app with rooms, agent spawning, and a Slack-style UI. Load the init skill or tell them to type `/init`.
- **Explore the docs** — read about other coordination patterns (blackboard, pipeline, map-reduce), dive into the API reference, or learn about shared state, context assembly, and other advanced features. Use `search_durable_agents_docs` to look things up.

Wait for the user to choose. Only proceed to Step 4 if they want to continue building.

**Step 4 — API route.** Show the updated server.ts with a `POST /api/analyze` route using `createRuntimeServerClient`. Explain what's new in the code. Ask to write — do NOT write until they confirm. After writing, give curl test commands.

**Step 5 — After confirmation:** scaffold the UI. Spawn a worker (`tools: ["bash"]`, systemPrompt: `"Copy UI scaffold files into the project."`, initialMessage: `"cp -r SKILL_DIR/scaffold-ui/. TARGET/ui/"` — replace SKILL_DIR and TARGET). While the worker copies, explain the frontend architecture: `createAgentsClient` connects to the agent server, `entity(url)` subscribes to an entity's stream, `useChat` reactively assembles text from deltas, and Radix Themes provides the UI components. Walk through the key parts of `ui/main.tsx` — the `useEntityDb` hook (with retry for workers that are spawned asynchronously), `useAgentMessages`, `MessageBubble` (color-coded by agent: blue for analyser, green for optimist, red for critic), and the `App` component's flow (POST to `/api/analyze` → subscribe to all three entity streams → messages appear inline as chat bubbles). After the worker finishes, tell the user to run `npm run dev:all` to start both the server and UI, then open `http://localhost:5175`.

**Step 6 — Recap.**

## Rules

- Show only the key changes in each step, not the full file. Explain what's new and why, then use the write/edit tool to apply the changes. The code below is a reference — do not dump the entire file on the user.
- `server.ts` is at the working directory root. Entity files go in `entities/`.
- Worker spawn args MUST include `tools` array (at least one tool, e.g. `tools: ["bash"]`).
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
      'You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities and benefits. Answer directly — do not comment on tools or capabilities.',
  },
  {
    id: 'critic',
    systemPrompt:
      'You are a critical analyst. Provide a sharp analysis focusing on risks, downsides, and challenges. Answer directly — do not comment on tools or capabilities.',
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
          { systemPrompt: p.systemPrompt, tools: ['bash'] },
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

## Step 4: Server routes

You now have a working multi-agent system: a manager entity that spawns optimist and critic workers, coordinates their responses, and synthesizes the analysis. Everything works from the CLI.

Next, we'll turn this into a real app. The server.ts you've been running is a plain Node.js HTTP server — we can add routes to it, serve a frontend, and let users interact with the analyzer from a browser. First step: an API route.

`createRuntimeServerClient()` gives you a programmatic client for spawning entities and sending messages from your server code — the same operations you've been doing with the CLI.

Update `server.ts` — add the runtime server client and an `/api/analyze` route:

```typescript
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEntityRegistry,
  createRuntimeHandler,
  createRuntimeServerClient,
} from '@electric-ax/agents-runtime'
import { createElectricTools } from './lib/electric-tools'
import { registerPerspectives } from './entities/perspectives'

try {
  const here = path.dirname(fileURLToPath(import.meta.url))
  process.loadEnvFile(path.resolve(here, '.env'))
} catch {}

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[app] ANTHROPIC_API_KEY is not set — agent.run() will throw on the first wake.'
  )
}

const ELECTRIC_AGENTS_URL =
  process.env.ELECTRIC_AGENTS_URL ?? 'http://localhost:4437'
const PORT = Number(process.env.PORT ?? 3000)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()
registerPerspectives(registry)

const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
  createElectricTools,
})

const client = createRuntimeServerClient({ baseUrl: ELECTRIC_AGENTS_URL })

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Array<Buffer> = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/webhook' && req.method === 'POST') {
    await runtime.onEnter(req, res)
    return
  }

  if (req.url === '/api/analyze' && req.method === 'POST') {
    try {
      const body = (await readJson(req)) as { question?: string }
      if (!body.question) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing "question" field' }))
        return
      }

      const id = `analysis-${crypto.randomUUID().slice(0, 8)}`

      await client.spawnEntity({
        type: 'perspectives',
        id,
        initialMessage: body.question,
      })

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          entityUrl: `/perspectives/${id}`,
          optimistUrl: `/worker/${id}-optimist`,
          criticUrl: `/worker/${id}-critic`,
        })
      )
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        })
      )
    }
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`App server ready on port ${PORT}`)
})
```

Test with curl:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"question":"Is remote work better than office work?"}'
```

Then observe the spawned entity:

```bash
pnpm electric-agents observe /perspectives/analysis-<id>
```

**Key concepts:**

- `createRuntimeServerClient({ baseUrl })` — programmatic client for the agent server
- `client.spawnEntity({ type, id, initialMessage })` — spawns an entity and sends a message in one call
- Entity URLs are addressable — child worker URLs are deterministic (`<id>-optimist`, `<id>-critic`)

## Step 5: Frontend — live results

The UI files are pre-built in the scaffold. Copy them into the project, then read and explain them.

The scaffold includes:

- `ui/index.html` — HTML shell
- `ui/main.tsx` — React app with Radix Themes, `createAgentsClient`, `useChat` hook
- `vite.config.ts` — Vite dev server with proxy to the app server

The `vite.config.ts` was already included in the initial scaffold. The `ui/` files are copied from `SKILL_DIR/scaffold-ui/`.

After copying, read `ui/main.tsx` with the user and walk through the key parts with code snippets:

### Connecting to an entity stream

The `useEntityDb` hook subscribes to a single entity's durable stream. This is the bridge between the agent server and React:

```tsx
function useEntityDb(url: string | null, retryMs = 0) {
  const [db, setDb] = useState<EntityStreamDB | null>(null)

  useEffect(() => {
    if (!url) {
      setDb(null)
      return
    }
    let cancelled = false
    const connect = () => {
      const client = createAgentsClient({ baseUrl: AGENTS_URL })
      client.observe(entity(url)).then(
        (observed) => {
          if (!cancelled) setDb(observed as EntityStreamDB)
        },
        () => {
          if (!cancelled && retryMs > 0) setTimeout(connect, retryMs)
        }
      )
    }
    connect()
    return () => {
      cancelled = true
    }
  }, [url, retryMs])

  return db
}
```

`createAgentsClient` connects to the agent server. `entity(url)` tells it which entity to observe. The connection is via SSE — updates arrive in real time, no polling. `retryMs` handles workers that don't exist yet (the manager spawns them asynchronously).

### Extracting messages with useChat

The `useAgentMessages` hook takes an entity stream and extracts text messages using `useChat`:

```tsx
function useAgentMessages(
  url: string | null,
  agent: string,
  retryMs = 0
): AgentMessage[] {
  const db = useEntityDb(url, retryMs)
  const chat = useChat(db)

  return chat.runs.flatMap((r, ri) =>
    r.texts
      .filter((t) => t.text.trim().length > 0)
      .map((t, ti) => ({
        agent,
        text: t.text,
        isStreaming:
          chat.state === 'working' &&
          ri === chat.runs.length - 1 &&
          ti === r.texts.length - 1,
      }))
  )
}
```

`useChat(db)` is the key hook — it reactively assembles text from the entity's `textDeltas` collection (token-by-token streaming) into complete text blocks. `chat.runs` contains each agent run with its `texts`. `chat.state` tells you if the agent is `'working'` (still generating) or `'idle'` (done).

### Rendering messages

Each message is a color-coded card with markdown rendering via `Streamdown`:

```tsx
function MessageBubble({ msg }: { msg: AgentMessage }) {
  const colors = AGENT_COLORS[msg.agent]
  return (
    <Card
      size="1"
      style={{
        background: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
      }}
    >
      <Text size="1" weight="bold" style={{ textTransform: 'capitalize' }}>
        {msg.agent}
      </Text>
      <Box mt="1" style={{ fontSize: 'var(--font-size-2)' }}>
        <Streamdown isAnimating={msg.isStreaming} controls={false}>
          {msg.text}
        </Streamdown>
      </Box>
    </Card>
  )
}
```

Blue for the analyser, green for the optimist, red for the critic. `Streamdown` renders markdown and shows a streaming cursor while `isAnimating` is true.

### Wiring it together

The `App` component subscribes to all three entities and renders messages inline:

```tsx
const analyserMessages = useAgentMessages(urls?.entityUrl ?? null, 'analyser')
const optimistMessages = useAgentMessages(
  urls?.optimistUrl ?? null,
  'optimist',
  2000
)
const criticMessages = useAgentMessages(urls?.criticUrl ?? null, 'critic', 2000)

const allMessages = [
  ...analyserMessages,
  ...optimistMessages,
  ...criticMessages,
]
```

Workers get `retryMs=2000` because they're spawned asynchronously — the manager calls `analyze_question`, which spawns them, but they may not exist yet when the UI first tries to connect.

After explaining, tell the user to restart with `npm run dev:all` (starts both server and Vite). Open `http://localhost:5175`.

**Key concepts:**

- `createAgentsClient({ baseUrl })` — connects the frontend to the agent server
- `client.observe(entity(url))` — subscribes to an entity's durable stream via SSE
- `useChat(db)` — reactive hook that assembles text from `textDeltas`, tracks agent state
- `chat.state` — `'working'` means the agent is actively generating text
- `Streamdown` — renders markdown with streaming cursor support
- No polling — the durable stream pushes updates to the browser

## What you learned

| Step | Concept                 | API                                                         |
| ---- | ----------------------- | ----------------------------------------------------------- |
| 1    | Entity types & handlers | `registry.define()`, `ctx.useAgent()`, `ctx.agent.run()`    |
| 2    | Spawning children       | `ctx.spawn()`, `wake: 'runFinished'`                        |
| 3    | State collections       | `state: { children: { primaryKey: 'key' } }`                |
| 4    | Server routes           | `createRuntimeServerClient()`, `client.spawnEntity()`       |
| 5    | Live frontend           | `createAgentsClient`, `entity()`, `useChat`, streaming text |

For a complete multi-agent chat app with rooms, agent spawning, and a Slack-style UI, see the [agents-chat-starter](https://github.com/electric-sql/electric/tree/main/examples/agents-chat-starter) example.

Want to keep going? Just ask me anything — I can search the Electric Agents docs for coordination patterns (pipeline, map-reduce, blackboard), API reference, shared state, context assembly, and more.
