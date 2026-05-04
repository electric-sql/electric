---
title: Embedded built-ins
titleTemplate: "... - Electric Agents"
description: >-
  Embed the built-in Horton and worker runtime in your own process using
  @electric-ax/agents, BuiltinAgentsServer, or the entrypoint helpers.
outline: [2, 3]
---

# Embedded built-ins

The CLI commands `electric agents start-builtin` and `electric agents quickstart` run the built-in Horton and worker runtime for you. If you need to host those built-ins inside your own process, use the exported APIs from `@electric-ax/agents`.

## BuiltinAgentsServer

`BuiltinAgentsServer` starts an HTTP webhook server, registers `horton` and `worker`, and forwards Electric Agents webhook wakes to the built-in handler.

```ts
import { BuiltinAgentsServer } from "@electric-ax/agents"

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  port: 4448,
  workingDirectory: process.cwd(),
})

await server.start()

console.log(server.url)
console.log(server.registeredBaseUrl)

// Later, during shutdown:
await server.stop()
```

### Options

```ts
import type { RuntimeRouterConfig } from "@electric-ax/agents-runtime"

type CreateElectricTools = RuntimeRouterConfig["createElectricTools"]

interface BuiltinAgentsServerOptions {
  agentServerUrl: string
  baseUrl?: string
  port: number
  host?: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  webhookPath?: string
  createElectricTools?: CreateElectricTools
}
```

| Field                 | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `agentServerUrl`      | Electric Agents coordinator server URL.                                     |
| `baseUrl`             | Public base URL used when registering the webhook. Defaults to local URL.   |
| `port`                | Local webhook server port.                                                  |
| `host`                | Bind host. Defaults to `127.0.0.1`.                                         |
| `workingDirectory`    | Directory used by Horton and worker file tools. Defaults to `process.cwd()`. |
| `mockStreamFn`        | Optional test stream function. Lets you run without `ANTHROPIC_API_KEY`.    |
| `webhookPath`         | Webhook path. Defaults to `/_electric/builtin-agent-handler`.               |
| `createElectricTools` | Optional factory for extra tools injected into built-in agent handlers.     |

Without `mockStreamFn`, `ANTHROPIC_API_KEY` must be present before the built-in handler starts.

## createBuiltinAgentHandler

Use `createBuiltinAgentHandler()` when you already have an HTTP server and only need the request handler and runtime objects.

```ts
import {
  createBuiltinAgentHandler,
  registerBuiltinAgentTypes,
} from "@electric-ax/agents"

const bootstrap = await createBuiltinAgentHandler({
  agentServerUrl: "http://localhost:4437",
  serveEndpoint: "https://example.com/_electric/builtin-agent-handler",
  workingDirectory: process.cwd(),
})

if (!bootstrap) {
  throw new Error("ANTHROPIC_API_KEY is required for built-in agents")
}

await registerBuiltinAgentTypes(bootstrap)

// In your HTTP server:
await bootstrap.handler(req, res)
```

### Result

```ts
interface AgentHandlerResult {
  handler(req: IncomingMessage, res: ServerResponse): Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: string[]
  skillsRegistry: SkillsRegistry | null
}
```

## Extra Electric Tools

Both `BuiltinAgentsServer` and `createBuiltinAgentHandler()` accept `createElectricTools`. The factory receives the same context shape as `RuntimeRouterConfig.createElectricTools` and can add host-specific tools to Horton.

```ts
import { Type } from "@sinclair/typebox"

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  port: 4448,
  createElectricTools: ({ entityUrl, upsertCronSchedule }) => [
    {
      name: "schedule_daily_summary",
      label: "Schedule daily summary",
      description: "Schedule a daily summary wake for this entity.",
      parameters: Type.Object({
        hour: Type.Number(),
      }),
      execute: async (_id, params) => {
        const { hour } = params as { hour: number }
        await upsertCronSchedule({
          id: "daily-summary",
          expression: `0 ${hour} * * *`,
          payload: `Run daily summary for ${entityUrl}`,
        })
        return { content: [{ type: "text", text: "Scheduled." }], details: {} }
      },
    },
  ],
})
```

## Entrypoint Helpers

`runBuiltinAgentsEntrypoint()` reads environment variables, creates a `BuiltinAgentsServer`, and starts it. This is what the `electric-agents` package binary uses.

```ts
import {
  resolveBuiltinAgentsEntrypointOptions,
  runBuiltinAgentsEntrypoint,
} from "@electric-ax/agents"

const options = resolveBuiltinAgentsEntrypointOptions(process.env)
const { server, url } = await runBuiltinAgentsEntrypoint()

console.log(options.agentServerUrl, url)
await server.stop()
```

Environment variables:

| Variable                         | Description                                           |
| -------------------------------- | ----------------------------------------------------- |
| `ELECTRIC_AGENTS_SERVER_URL`     | Required coordinator server URL.                      |
| `ELECTRIC_AGENTS_BUILTIN_BASE_URL` | Public webhook base URL for the built-in server.   |
| `ELECTRIC_AGENTS_BUILTIN_HOST`   | Bind host.                                            |
| `ELECTRIC_AGENTS_BUILTIN_PORT`   | Built-in server port. Defaults to `4448`.             |
| `ELECTRIC_AGENTS_WORKING_DIRECTORY` | Working directory for file tools. |

## Built-in Agent APIs

The built-in agent exports are also available if you want to compose your own runtime:

| Export                    | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `registerHorton()`        | Register the `horton` type on an `EntityRegistry`.  |
| `registerWorker()`        | Register the `worker` type on an `EntityRegistry`.  |
| `HORTON_MODEL`            | Default model id used by Horton and worker.         |
| `buildHortonSystemPrompt()` | Build Horton's system prompt for a working directory. |
| `createHortonTools()`     | Create Horton's base shell/file/search/worker tools. |
| `createSpawnWorkerTool()` | Create the `spawn_worker` tool for another agent.   |
| `WORKER_TOOL_NAMES`       | Valid primitive tool names for workers.             |
| `createHortonDocsSupport()` | Create Horton's docs knowledge-base support.       |

For the behavior of `horton` and `worker`, see [Horton](../entities/agents/horton) and [Worker](../entities/agents/worker).
