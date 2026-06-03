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

`BuiltinAgentsServer` registers `horton` and `worker`, advertises the runtime's sandbox profiles, and starts a pull-wake runner that claims wakes from the Electric Agents server. This is the same model used by the CLI and desktop app.

```ts
import { BuiltinAgentsServer } from "@electric-ax/agents"

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  workingDirectory: process.cwd(),
  loadProjectMcpConfig: true,
  pullWake: {
    runnerId: "builtin-agents",
    ownerPrincipal: "/principal/system%3Abuiltin-agents",
    registerRunner: true,
  },
})

const runtimeUrl = await server.start()
console.log(runtimeUrl) // "pull-wake:builtin-agents"

// Later, during shutdown:
await server.stop()
```

### Options

```ts
import type { RuntimeRouterConfig } from "@electric-ax/agents-runtime"

type CreateElectricTools = RuntimeRouterConfig["createElectricTools"]

interface BuiltinAgentsServerOptions {
  agentServerUrl: string
  workingDirectory?: string
  mockStreamFn?: StreamFn
  pullWake: {
    runnerId: string
    ownerPrincipal?: string
    label?: string
    registerRunner?: boolean
    headers?: HeadersProvider
    claimHeaders?: HeadersProvider
    claimTokenHeader?: ClaimTokenHeader
    heartbeatIntervalMs?: number
    eventHeartbeatThrottleMs?: number
    leaseMs?: number
  }
  enabledModelValues?: readonly string[] | null
  baseSkillsDir?: string
  createElectricTools?: CreateElectricTools
  // MCP integration
  extraMcpServers?: ReadonlyArray<McpServerConfig>
  loadProjectMcpConfig?: boolean
  mcpOAuthRedirectBase?: string
  openAuthorizeUrl?: (url: string, server: string) => void
  onConfigError?: (error: unknown) => void
}
```

| Field                  | Description                                                                                                                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentServerUrl`       | Electric Agents coordinator server URL.                                                                                                                                                                                                                                                |
| `workingDirectory`     | Directory used by Horton and worker file tools. Defaults to `process.cwd()`.                                                                                                                                                                                                           |
| `mockStreamFn`         | Optional test stream function. Lets you run without a real model provider.                                                                                                                                                                                                             |
| `pullWake`             | Pull-wake runner configuration. `runnerId` identifies this runtime to the server. Set `registerRunner: true` when this process should create/update the runner record.                                                                                                                  |
| `enabledModelValues`   | Optional allowlist of model values exposed by built-in agent creation schemas. Values use the model catalog's `provider:model` form.                                                                                                                                                    |
| `baseSkillsDir`        | Override for the bundled skills directory, useful when an embedder packages `@electric-ax/agents`.                                                                                                                                                                                      |
| `createElectricTools`  | Optional factory for extra tools injected into built-in agent handlers.                                                                                                                                                                                                                |
| `extraMcpServers`      | MCP servers contributed by the embedder. On name conflict with `mcp.json`, `mcp.json` wins. `authorizationCode` servers are auto-wired with `keychainPersistence`.                                                                                                                     |
| `loadProjectMcpConfig` | Load `<workingDirectory>/mcp.json` (and watch it). Off by default because stdio MCP servers can spawn local commands, so embedders must opt in. The Electron desktop and `electric-ax` CLI opt in.                                                                                      |
| `mcpOAuthRedirectBase` | Base for OAuth redirect URIs (full URI is `<base>/oauth/callback/<server-name>`). Must be stable across restarts so DCR client info stays valid. The runtime never listens at this URI; the embedder intercepts the redirect.                                                          |
| `openAuthorizeUrl`     | Hook invoked when an `authorizationCode` MCP server first needs user consent. Receives the SDK-generated authorize URL. The desktop opens it in a sandboxed `BrowserWindow`; headless embedders can read the URL from the `authenticating` envelope of `addServer` and surface it themselves. |
| `onConfigError`        | Invoked when applying an MCP config (initial boot or watcher reload) fails. Errors are always logged; this hook is for surfacing them programmatically.                                                                                                                                |

Without `mockStreamFn`, at least one supported provider must be configured before the built-in handler starts: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, or a valid OpenAI Codex CLI auth file for the `openai-codex` provider.

### Pull-wake headers and principals

When the server enforces principals or auth, pass the same headers to runner registration and wake claims:

```ts
const serverHeaders = {
  "electric-principal": "service:local-runtime",
  authorization: `Bearer ${process.env.ELECTRIC_AGENTS_TOKEN}`,
}

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  pullWake: {
    runnerId: "local-runtime",
    ownerPrincipal: "/principal/service%3Alocal-runtime",
    registerRunner: true,
    headers: serverHeaders,
    claimHeaders: serverHeaders,
    claimTokenHeader: "electric-claim-token",
  },
})
```

Use `claimTokenHeader: "electric-claim-token"` when your `authorization` header is reserved for server auth. Otherwise the default claim token transport is the standard `Authorization: Bearer <claim-token>` header.

## createBuiltinAgentHandler

Use `createBuiltinAgentHandler()` when you need the lower-level registry/runtime objects. If you pass `serveEndpoint`, `registerTypes()` registers webhook dispatch for the built-in types. If you are using pull-wake, prefer `BuiltinAgentsServer`, which wires runner registration, MCP, sandbox profiles, and wake claiming for you.

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
  throw new Error("No supported model provider is configured")
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
import { BuiltinAgentsServer } from "@electric-ax/agents"
import { Type } from "@sinclair/typebox"

const server = new BuiltinAgentsServer({
  agentServerUrl: "http://localhost:4437",
  pullWake: {
    runnerId: "builtin-agents",
    registerRunner: true,
  },
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

| Variable                                   | Description                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `ELECTRIC_AGENTS_SERVER_URL`               | Required coordinator server URL.                                            |
| `ELECTRIC_AGENTS_BASE_URL`                 | Legacy alias for `ELECTRIC_AGENTS_SERVER_URL`.                              |
| `ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID`      | Required pull-wake runner id.                                               |
| `PULL_WAKE_RUNNER_ID`                      | Legacy alias for `ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID`.                     |
| `ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER` | Set to `true` or `1` to register/update the runner record before claiming. |
| `ELECTRIC_AGENTS_PRINCIPAL`                | Optional principal key sent as `Electric-Principal`.                        |
| `ELECTRIC_AGENTS_SERVER_HEADERS`           | Optional JSON object of additional server headers.                          |
| `ELECTRIC_AGENTS_WORKING_DIRECTORY`        | Working directory for file tools.                                           |
| `WORKING_DIRECTORY`                        | Legacy alias for `ELECTRIC_AGENTS_WORKING_DIRECTORY`.                       |

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
