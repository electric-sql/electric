---
title: Quickstart
titleTemplate: "... - Electric Agents"
description: >-
  Get Electric Agents up and running in a few seconds and then define custom agents running in your own web app or serverless functions.
outline: [2, 3]
---

# Quickstart

Get Electric Agents up and running in a few seconds and then define custom agents that run in your own web app (or serverless functions).

## Runtime components

The Electric Agents runtime has three key components:

1. **Runtime server** — the durable streams server that persists entity state.
2. **CLI** — a command-line tool for spawning entities, sending messages, and streaming events.
3. **Web UI** — a dashboard for observing and interacting with entities.

The first step is to get these running, with a built-in agent you can use right away.

You can then define and engineer agents (and agent topologies and coordination patterns, ...) in **your own web app** that uses `@electric-ax/agents-runtime` to register with the runtime.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/installation) (if you're working from a local checkout)
- [Docker](https://docs.docker.com/get-docker/) (the dev server runs Postgres and Electric in containers)

## Clone the repo

If you're developing against the monorepo packages, clone Electric:

```sh
git clone git@github.com:electric-sql/electric.git
cd electric
pnpm install
```

## Setup environment variables

Create a `.env` file with:

- `ANTHROPIC_API_KEY` (mandatory)
- `BRAVE_SEARCH_API_KEY` (optional, if you're using agents that search)

E.g.:

```sh
cat <<'EOF' > .env
ANTHROPIC_API_KEY="sk-ant-..."
BRAVE_SEARCH_API_KEY="BS..."
EOF
```

## Try the built-in Horton assistant

The runtime server ships with a built-in agent type, `horton` — a friendly capable assistant that can chat, research the web, read and edit code, run shell commands, and dispatch subagents. It's the easiest way to try Electric Agents before writing any code.

### 1. Start the runtime server

```sh
npx electric-ax agents quickstart --anthropic-api-key "$ANTHROPIC_API_KEY"
```

This starts Postgres and Electric containers via Docker, launches the Electric Agents runtime server, starts the built-in agents runtime with `horton` and `worker` registered, and prints the UI URL. The server defaults to `http://localhost:4437`.

### 2. Interact via CLI

In a separate terminal, spawn a Horton entity, send it a message, and observe the output:

```sh
npx electric-ax agents spawn /horton/my-horton
npx electric-ax agents send /horton/my-horton 'Hello!'
npx electric-ax agents observe /horton/my-horton
```

- `spawn` creates a new entity instance at the given path.
- `send` delivers a message to the entity's inbox, waking its handler.
- `observe` streams the entity's events to your terminal in real-time.

### 3. Open the web UI

The quickstart command prints the UI URL. Open it to observe and interact with entities visually.

## Create your own entity types

Once you've seen the built-in agents in action, you can define your own entity types in your own app.

### Set up your app

Your app is a separate project that uses `@electric-ax/agents-runtime` to define entities and handle webhooks.

Install the runtime package:

```sh
pnpm add @electric-ax/agents-runtime
```

If you're using the packages directly from a local Electric checkout, add the package paths to your app's `pnpm-workspace.yaml` instead. For example, if your app is at `~/my-app` and you cloned Electric to `~/electric`, add:

```yaml
packages:
  - "packages/*"
  - "../electric/packages/agents-runtime"
```

Then run `pnpm install` in your app to link the workspace packages.

### Create your app server

Create `server.ts` in your app:

```ts
import http from "node:http"
import {
  createEntityRegistry,
  createRuntimeHandler,
} from "@electric-ax/agents-runtime"

const ELECTRIC_AGENTS_URL = process.env.ELECTRIC_AGENTS_URL ?? "http://localhost:4437"
const PORT = Number(process.env.PORT ?? 3000)
const SERVE_URL = process.env.SERVE_URL ?? `http://localhost:${PORT}`

const registry = createEntityRegistry()

registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-5-20250929",
      tools: [...ctx.electricTools],
    })
    await ctx.agent.run()
  },
})

const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL,
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
  console.log(`App server ready on port ${PORT}`)
})
```

This does four things:

1. **Defines an entity type** called `assistant` with a handler that configures and runs an LLM agent.
2. **Creates a runtime handler** that connects to the Electric Agents runtime server.
3. **Starts an HTTP server** that receives webhook callbacks from the runtime.
4. **Registers entity types** with the runtime server on startup.

### Run your app

Make sure the runtime server is already running, then:

```sh
npx tsx server.ts
```

### Interact with your entity

From your app:

```sh
npx electric-ax agents spawn /assistant/my-assistant
npx electric-ax agents send /assistant/my-assistant 'Hello!'
npx electric-ax agents observe /assistant/my-assistant
```

## Next steps

- [Overview](./) — understand the mental model.
- [Defining entities](./usage/defining-entities) — entity types, schemas, and configuration.
- [Writing handlers](./usage/writing-handlers) — handler lifecycle and context API.
