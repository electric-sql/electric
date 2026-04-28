---
title: Configuring the agent
titleTemplate: '... - Electric Agents'
description: >-
  Set up LLM agents with ctx.useAgent(), including model selection, system prompts, tools, and test responses.
outline: [2, 3]
---

# Configuring the agent

Call `ctx.useAgent()` in your handler to set up the LLM, then `ctx.agent.run()` to execute it.

## AgentConfig

```ts
interface AgentConfig {
  systemPrompt: string
  model: string | Model<any>
  provider?: KnownProvider
  tools: AgentTool[]
  streamFn?: StreamFn
  testResponses?: string[] | TestResponseFn
}
```

| Field           | Required | Description                                                                                                            |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `systemPrompt`  | Yes      | The system prompt passed to the LLM.                                                                                   |
| `model`         | Yes      | Model identifier string or resolved model object.                                                                      |
| `provider`      | No       | Provider to use when `model` is a string. Defaults to `"anthropic"`.                                                   |
| `tools`         | Yes      | Array of tools available to the agent. Spread `ctx.electricTools` when your runtime host provides runtime-level tools. |
| `streamFn`      | No       | Optional streaming callback passed to the underlying agent.                                                            |
| `testResponses` | No       | Mock responses for testing without calling the LLM.                                                                    |

## Basic usage

```ts
async handler(ctx) {
  ctx.useAgent({
    systemPrompt: 'You are a helpful assistant.',
    model: 'claude-sonnet-4-5-20250929',
    tools: [...ctx.electricTools],
  })
  await ctx.agent.run()
}
```

`useAgent` returns an `AgentHandle` and also sets `ctx.agent`. Both references are equivalent.

To control what content fills the agent's context window (token budgets, cache tiers, external sources), use `ctx.useContext()` alongside `useAgent`. See [Context composition](./context-composition).

## ctx.electricTools

`ctx.electricTools` is an array of runtime-provided tools. It may be empty, or it may contain host-provided tools such as schedule management tools. Spread it into the `tools` array when you want the LLM agent to access those runtime-level tools:

```ts
tools: [...ctx.electricTools, myCustomTool, anotherTool]
```

Handler-level coordination APIs such as `ctx.spawn`, `ctx.observe`, and `ctx.send` are available on `HandlerContext` regardless of whether you pass `ctx.electricTools` to the LLM.

## ctx.agent.run()

Executes the agent loop. Blocks until the LLM finishes -- all tool calls are resolved and the final text response is emitted.

```ts
const result = await ctx.agent.run()
```

Returns an `AgentRunResult`:

```ts
type AgentRunResult = {
  writes: ChangeEvent[]
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  usage: { tokens: number; duration: number }
}
```

| Field       | Description                                                                             |
| ----------- | --------------------------------------------------------------------------------------- |
| `writes`    | Currently returned as an empty array placeholder.                                       |
| `toolCalls` | Currently returned as an empty array placeholder.                                       |
| `usage`     | Currently returned as `{ tokens: 0, duration: 0 }` until usage aggregation is wired in. |

## AgentHandle

Returned by `useAgent`. Also accessible as `ctx.agent`.

```ts
interface AgentHandle {
  run: (input?: string) => Promise<AgentRunResult>
}
```

You must call `useAgent` before calling `run()`. Calling `ctx.agent.run()` without prior configuration throws an error.

## Model

When `model` is a string, the runtime resolves it through the configured `provider` (default `"anthropic"`). You can also pass a resolved `Model` object directly.

```ts
model: 'claude-sonnet-4-5-20250929'
provider: 'anthropic'
```

## Test responses

For testing handlers without making LLM calls, pass `testResponses`. Two forms are supported:

**Array of strings** -- selected by the number of prior runs, useful for deterministic repeated wakes:

```ts
ctx.useAgent({
  systemPrompt: '...',
  model: 'claude-sonnet-4-5-20250929',
  tools: [...ctx.electricTools],
  testResponses: ['Hello! How can I help?', 'Sure, I can do that.'],
})
```

**Function** -- called for each turn with the current message and an `OutboundBridgeHandle`:

```ts
ctx.useAgent({
  // ...
  testResponses: async (message, bridge) => {
    if (message.includes('calculate')) {
      return 'The answer is 42.'
    }
    return undefined // emits no automatic text response
  },
})
```

See [Testing](./testing) for more on writing tests with `testResponses`.
