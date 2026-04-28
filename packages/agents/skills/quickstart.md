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

Once the directory is confirmed, read `server.ts` in that directory:

- **Has `registerPerspectives`**: resume from where they left off (read `entities/perspectives.ts` to determine the step)
- **Has `server.ts` but no perspectives**: go to Step 1
- **No `server.ts`**: scaffold the project — spawn a worker (`tools: ["bash"]`, systemPrompt: `"Set up an Electric Agents app project."`, initialMessage: `"mkdir -p TARGET/lib TARGET/entities && cp SKILL_DIR/scaffold/* TARGET/ && cp SKILL_DIR/scaffold/lib/* TARGET/lib/ && cp SKILL_DIR/scaffold/.env TARGET/ && cd TARGET && pnpm install && pnpm dev &"` — replace SKILL_DIR and TARGET). Then proceed to Step 1 while the worker runs. Wait for the worker to finish before writing files.

## Steps

**Step 1 — Welcome + first entity.** In one message: introduce Electric Agents using the Core Concepts above, preview the perspectives analyzer, and show the Step 1 code. Ask to write.

**Step 2 — After confirmation:** write `entities/perspectives.ts` with Step 1 code. Give CLI commands. Explain spawning briefly, show Step 2 code (adds one worker). Ask to write.

**Step 3 — After confirmation:** write the updated file. Give CLI commands. Explain coordination, show Step 3 code (adds critic + state). Ask to write.

**Step 4 — After confirmation:** write the updated file. Give CLI commands.

**Step 5 — Wire up.** Read `server.ts`, show the import change, ask to write, update it.

**Step 6 — After confirmation:** explain how entities integrate with HTTP. Show Step 6 code (adds routes to expose perspectives as an API). Ask to write.

**Step 7 — After confirmation:** write the route handler file. Update `server.ts` to mount routes. Give curl commands to test the full request lifecycle. Ask to continue.

**Step 8 — After confirmation:** explain how the frontend connects. Show Step 8 code (React UI). Create the UI files. Give commands to run it.

**Step 9 — Recap.**

## Rules

- Use the exact code below. Write files with your write tool.
- `server.ts` is at the working directory root. Entity files go in `entities/`.
- Worker spawn args MUST include `tools` array (e.g. `tools: ["bash", "read"]`).
- Prefer showing what changed between steps rather than repeating the entire file.
- Use `edit` tool for small changes (like updating server.ts). Use `write` for full entity file updates.

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

## Step 6: HTTP routes

`routes.ts`:

```typescript
import type { RuntimeServerClient } from '@electric-ax/agents-runtime'

export function createRoutes(client: RuntimeServerClient) {
  return {
    async handleAnalyze(req: Request): Promise<Response> {
      const { question } = (await req.json()) as { question: string }
      const id = `perspectives-${Date.now()}`

      await client.spawnEntity({
        entityType: 'perspectives',
        entityId: id,
        initialMessage: question,
      })

      return Response.json({ entityId: id, status: 'analyzing' })
    },

    async handleStatus(entityId: string): Promise<Response> {
      const info = await client.getEntityInfo({
        entityType: 'perspectives',
        entityId,
      })
      return Response.json(info)
    },
  }
}
```

`server.ts` additions:

```typescript
import { createRoutes } from './routes'
import { createRuntimeServerClient } from '@electric-ax/agents-runtime'

const client = createRuntimeServerClient({ baseUrl: ELECTRIC_AGENTS_URL })
const routes = createRoutes(client)

// Add inside the http.createServer callback, before the 404:
if (req.url === '/api/analyze' && req.method === 'POST') {
  const body = await new Promise<string>((resolve) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
  })
  const request = new Request('http://localhost', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
  const response = await routes.handleAnalyze(request)
  res.writeHead(response.status, { 'content-type': 'application/json' })
  res.end(await response.text())
  return
}

const statusMatch = req.url?.match(/^\/api\/status\/(.+)$/)
if (statusMatch && req.method === 'GET') {
  const response = await routes.handleStatus(statusMatch[1]!)
  res.writeHead(response.status, { 'content-type': 'application/json' })
  res.end(await response.text())
  return
}
```

Test: `curl -X POST http://localhost:3000/api/analyze -H 'Content-Type: application/json' -d '{"question": "Is remote work better than office work?"}'`

Then: `curl http://localhost:3000/api/status/<entityId>`

## Step 8: Frontend

`ui/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Perspectives Analyzer</title>
    <script type="module" src="./main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

`ui/main.tsx`:

```tsx
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'

function App() {
  const [question, setQuestion] = useState('')
  const [entityId, setEntityId] = useState<string | null>(null)
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function analyze() {
    setLoading(true)
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    })
    const data = await res.json()
    setEntityId(data.entityId)
    setLoading(false)
    pollStatus(data.entityId)
  }

  async function pollStatus(id: string) {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/status/${id}`)
      const data = await res.json()
      setStatus(data)
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(interval)
      }
    }, 2000)
  }

  return (
    <div
      style={{ maxWidth: 600, margin: '2rem auto', fontFamily: 'system-ui' }}
    >
      <h1>Perspectives Analyzer</h1>
      <div>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question..."
          style={{ width: '100%', padding: '0.5rem', fontSize: '1rem' }}
        />
        <button onClick={analyze} disabled={loading || !question}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      {status && (
        <div style={{ marginTop: '1rem' }}>
          <h2>Status: {status.status}</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
```

Add to `server.ts` — serve static files from `ui/`:

```typescript
import fs from 'node:fs'

// Add inside http.createServer callback, before the 404:
if (req.method === 'GET' && req.url?.startsWith('/ui')) {
  const filePath = path.join(here, req.url)
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath)
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.tsx': 'application/javascript',
      '.css': 'text/css',
    }
    res.writeHead(200, { 'content-type': types[ext] ?? 'text/plain' })
    res.end(fs.readFileSync(filePath, 'utf-8'))
    return
  }
}
```

Test: Open `http://localhost:3000/ui/index.html` in a browser.

## What you learned

- `registry.define()` — entity types with description, state, handler
- `ctx.useAgent()` + `ctx.agent.run()` — configure and run an LLM agent
- `ctx.spawn()` — spawn child entities with custom prompts
- Wake events — parents wake when children finish
- State collections — track data across wakes
- The worker pattern — one generic type, many roles
- HTTP routes — expose entities as API endpoints
- `createRuntimeServerClient()` — spawn and query entities programmatically
- Frontend integration — build a UI that talks to your agent API
