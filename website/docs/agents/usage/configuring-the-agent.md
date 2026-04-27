---
title: Configuring the agent
titleTemplate: "... - Electric Agents"
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
  model: string
  tools: AgentTool[]
  streamFn?: StreamFn
  testResponses?: string[] | TestResponseFn
}
```

| Field           | Required | Description                                                             |
| --------------- | -------- | ----------------------------------------------------------------------- |
| `systemPrompt`  | Yes      | The system prompt passed to the LLM.                                    |
| `model`         | Yes      | Model identifier string, passed through to the provider.                |
| `tools`         | Yes      | Array of tools available to the agent. Always include `ctx.electricTools`. |
| `streamFn`      | No       | Custom streaming function. Defaults to the built-in Claude adapter.     |
| `testResponses` | No       | Mock responses for testing without calling the LLM.                     |

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

`ctx.electricTools` is an array of runtime-provided tools that the agent needs to function correctly (e.g. sending messages, reporting results). Always spread these into the `tools` array:

```ts
tools: [...ctx.electricTools, myCustomTool, anotherTool]
```

Omitting `ctx.electricTools` will break runtime coordination.

## ctx.agent.run()

Executes the agent loop. Blocks until the LLM finishes -- all tool calls are resolved and the final text response is emitted.

```ts
const result = await ctx.agent.run()
```

Returns an `AgentRunResult`:

```ts
type AgentRunResult = {
  result?: unknown
  writes: ChangeEvent[]
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  usage: { tokens: number; duration: number }
}
```

| Field       | Description                                             |
| ----------- | ------------------------------------------------------- |
| `result`    | Optional structured result from the run.                |
| `writes`    | All change events the agent produced during the run.    |
| `toolCalls` | Record of every tool call: name, arguments, and result. |
| `usage`     | Token count and wall-clock duration in milliseconds.    |

## AgentHandle

Returned by `useAgent`. Also accessible as `ctx.agent`.

```ts
interface AgentHandle {
  run: () => Promise<AgentRunResult>
}
```

You must call `useAgent` before calling `run()`. Calling `ctx.agent.run()` without prior configuration throws an error.

## Model

The `model` string is passed through to the underlying LLM provider. Currently uses Claude via the `pi-agent-core` adapter.

```ts
model: "claude-sonnet-4-5-20250929"
```

## Test responses

For testing handlers without making LLM calls, pass `testResponses`. Two forms are supported:

**Array of strings** -- returned in order, one per agent turn:

```ts
ctx.useAgent({
  systemPrompt: "...",
  model: "claude-sonnet-4-5-20250929",
  tools: [...ctx.electricTools],
  testResponses: ["Hello! How can I help?", "Sure, I can do that."],
})
```

**Function** -- called for each turn with the current message and an `OutboundBridgeHandle`:

```ts
ctx.useAgent({
  // ...
  testResponses: async (message, bridge) => {
    if (message.includes("calculate")) {
      return "The answer is 42."
    }
    return undefined // falls through to default behavior
  },
})
```

See [Testing](./testing) for more on writing tests with `testResponses`.
