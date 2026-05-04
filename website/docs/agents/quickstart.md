---
title: Quickstart
titleTemplate: "... - Electric Agents"
description: >-
  Run the Electric Agents runtime and the built-in Horton assistant with a single CLI command, then connect from the web UI or define your own entities.
outline: [2, 3]
---

# Quickstart

One command starts the Electric Agents runtime, the web UI, and a local [Horton](./entities/agents/horton) assistant you can chat with right away. From there, define your own [entities](./usage/defining-entities) in your own app.

```sh
npx electric-ax agents quickstart
```

## What you'll need

- **Node.js 18+**.
- **[Docker](https://docs.docker.com/get-docker/)**. The runtime server, Postgres, and Electric run as containers.
- **An [Anthropic API key](https://console.anthropic.com/settings/keys)**. Used by the built-in Horton agent.
- *(Optional)* A **[Brave Search API key](https://brave.com/search/api/)** if you want Horton to be able to search the web.

## Set your API key

Either export it in your shell:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Or persist it in a `.env` file in the directory you run the CLI from (this creates or overwrites `.env` in the current directory):

```sh
cat <<'EOF' > .env
ANTHROPIC_API_KEY=sk-ant-...
# BRAVE_SEARCH_API_KEY=BS...
EOF
```

The CLI also accepts `--anthropic-api-key <key>` if you'd rather pass it inline.

## Start the runtime

```sh
npx electric-ax agents quickstart
```

This:

1. Starts Postgres, Electric, and the Electric Agents runtime server in Docker (the runtime serves both the API and the web UI on `http://localhost:4437`).
2. Starts a built-in **Horton** runtime in the foreground that registers the `horton` and `worker` entity types.
3. Prints onboarding commands you can copy into a second terminal.

Leave this terminal running. Press `Ctrl-C` to stop the built-in Horton runtime — the runtime server containers keep running in the background until you call [`electric agents stop`](#stop-the-dev-environment).

## Chat with Horton

### From the web UI

Open [http://localhost:4437](http://localhost:4437). Spawn a `horton` entity from the dashboard and send it a message — its timeline updates live as the agent thinks, calls tools, and responds.

### From the CLI

In a separate terminal:

```sh
npx electric-ax agents spawn /horton/onboarding
npx electric-ax agents send /horton/onboarding 'Walk me through Electric Agents'
npx electric-ax agents observe /horton/onboarding
```

- `spawn` creates a new entity instance at the given path.
- `send` delivers a message to the entity's inbox, waking its handler.
- `observe` streams the entity's events to your terminal in real time, with reasoning, tool calls, and text deltas rendered inline.

See the [CLI reference](./reference/cli) for the full command surface.

## Define your own entity types

Once you're chatting with Horton, the next step is to define your own entity types in your own app. Your app is just a process that registers entity types with the runtime server and receives webhook callbacks when they wake.

### 1. Install the runtime SDK

```sh
mkdir my-agents-app && cd my-agents-app
npm init -y
npm install @electric-ax/agents-runtime
npm install --save-dev tsx
```

### 2. Create a server

Create `server.ts`:

```ts
import http from "node:http"
import {
  createEntityRegistry,
  createRuntimeHandler,
} from "@electric-ax/agents-runtime"

const ELECTRIC_AGENTS_URL =
  process.env.ELECTRIC_AGENTS_URL ?? "http://localhost:4437"
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
2. **Creates a runtime handler** that connects to the runtime server.
3. **Starts an HTTP server** to receive webhook callbacks from the runtime.
4. **Registers entity types** with the runtime server on startup.

See [App setup](./usage/app-setup) for the full `createRuntimeHandler` configuration.

### 3. Run your app

With the runtime server already running (from `electric agents quickstart` or `electric agents start`), start your app:

```sh
npx tsx server.ts
```

Your handler calls `ctx.useAgent()` in this process, so make sure `ANTHROPIC_API_KEY` is exported in this shell (or copy your `.env` into `my-agents-app`).

### 4. Interact with your entity

Spawn an instance, send it a message, and observe the timeline:

```sh
npx electric-ax agents spawn /assistant/my-assistant
npx electric-ax agents send /assistant/my-assistant 'Hello!'
npx electric-ax agents observe /assistant/my-assistant
```

Or open the web UI at `http://localhost:4437` and pick `/assistant/my-assistant` from the entity list.

## Stop the dev environment

`Ctrl-C` in the quickstart terminal stops the built-in Horton runtime. The runtime server containers keep running. To stop them:

```sh
npx electric-ax agents stop                  # stop containers, keep data
npx electric-ax agents stop --remove-volumes # stop containers and wipe data
```

## Run pieces independently

`quickstart` runs `start` then `start-builtin` for you. Run them yourself if you want the runtime server up across multiple sessions, or to run your own agent process instead of the built-ins:

```sh
npx electric-ax agents start          # runtime server + UI (background, Docker)
npx electric-ax agents start-builtin  # built-in Horton and worker (foreground)
```

See the [CLI reference](./reference/cli#start) for the full set of commands.

## Next steps

- [Overview](./) — the mental model behind entities, handlers, and wakes.
- [Usage overview](./usage/overview) — the full developer surface on one page.
- [Defining entities](./usage/defining-entities) — entity types, schemas, and configuration.
- [Writing handlers](./usage/writing-handlers) — handler lifecycle and the `ctx` API.
- [Configuring the agent](./usage/configuring-the-agent) — `useAgent`, models, tools, and streaming.
- [Built-in agents](./entities/agents/horton) — Horton, Worker, and Coder, the agents that ship with the runtime.
