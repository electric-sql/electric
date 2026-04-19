---
title: Grid app
titleTemplate: "... - Electric Agents"
description: >-
  Minimal production-ready Electric Agents app with two entity types, registry, and webhook server.
outline: [2, 3]
---

# Grid app

A minimal production example of an Electric Agents app. Located in a separate repository (not yet public).

## What it demonstrates

The simplest possible app setup:

- Two entity types (`assistant` and `runway`)
- Separate registry file with register functions
- HTTP server with webhook handler
- Type registration on startup

## Key files

### `src/server.ts`

Entry point. Creates the runtime handler and HTTP server.

```ts
import http from "node:http"
import { createRuntimeHandler } from "@durable-streams/darix-runtime"
import { registry } from "./entities/registry"

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

const server = http.createServer(async (req, res) => {
  if (req.url === "/webhook" && req.method === "POST") {
    await runtime.onEnter(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
})
```

### `src/entities/registry.ts`

Entity registry. Each entity type has its own register function.

```ts
import { createEntityRegistry } from "@durable-streams/darix-runtime"
import { registerAssistant } from "./assistant"
import { registerRunway } from "./runway"

export const registry = createEntityRegistry()
registerAssistant(registry)
registerRunway(registry)
```

### `src/entities/assistant.ts`

Minimal entity definition.

```ts
import type { EntityRegistry } from "@durable-streams/darix-runtime"

export function registerAssistant(registry: EntityRegistry) {
  registry.define("assistant", {
    description: "A general-purpose AI assistant",
    async handler(ctx) {
      ctx.configureAgent({
        systemPrompt: "You are a helpful assistant.",
        model: "claude-sonnet-4-5-20250929",
        tools: [...ctx.darixTools],
      })
      await ctx.agent.run()
    },
  })
}
```

## Environment

| Variable            | Default                    | Purpose            |
| ------------------- | -------------------------- | ------------------ |
| `ANTHROPIC_API_KEY` | ---                        | Claude API key     |
| `DARIX_URL`         | `http://localhost:4437`    | Runtime server     |
| `SERVE_URL`         | `http://localhost:${PORT}` | Public webhook URL |
| `PORT`              | `3000`                     | App HTTP port      |

## Running

```bash
pnpm install
cp .env.template .env  # Set ANTHROPIC_API_KEY
pnpm dev               # tsx watch with hot reload
```

Requires a running runtime server at `http://localhost:4437` (default).

This is a good starting point for new Electric Agents apps. Copy the structure and add your own entity types.
