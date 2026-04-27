---
title: AgentConfig
titleTemplate: "... - Electric Agents"
description: >-
  API reference for AgentConfig: system prompt, model, tools, streaming, and test responses.
outline: [2, 3]
---

# AgentConfig

Configuration for the LLM agent loop. Passed to `ctx.useAgent()`.

**Source:** `@electric-ax/agents-runtime`

```ts
interface AgentConfig {
  systemPrompt: string
  model: string
  tools: AgentTool[]
  streamFn?: StreamFn
  testResponses?: string[] | TestResponseFn
}
```

## Fields

| Field           | Type                         | Required | Description                                                                                         |
| --------------- | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `systemPrompt`  | `string`                     | Yes      | System prompt sent to the LLM on each step.                                                         |
| `model`         | `string`                     | Yes      | Model identifier (e.g. `"claude-sonnet-4-5-20250929"`).                                             |
| `tools`         | `AgentTool[]`                | Yes      | Tools available to the LLM. Always include `ctx.electricTools` first. See [`AgentTool`](./agent-tool). |
| `streamFn`      | `StreamFn`                   | No       | Custom streaming function. Overrides the default LLM provider.                                      |
| `testResponses` | `string[] \| TestResponseFn` | No       | Mock LLM responses for testing. When set, no real LLM calls are made.                               |

## TestResponseFn

```ts
type TestResponseFn = (
  message: string,
  bridge: OutboundBridgeHandle
) => Promise<string | undefined>
```

A function that receives the current conversation and returns a mock response string, or `undefined` to end the agent loop.

## AgentHandle

Returned by `ctx.useAgent()`. Also available as `ctx.agent`.

```ts
interface AgentHandle {
  run(input?: string): Promise<AgentRunResult>
}
```

| Method        | Return Type               | Description                                                                  |
| ------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `run(input?)` | `Promise<AgentRunResult>` | Execute the agent loop. Runs until the LLM stops or all tool calls complete. |

**Parameters:**

| Parameter | Type     | Required | Description                                                                      |
| --------- | -------- | -------- | -------------------------------------------------------------------------------- |
| `input`   | `string` | No       | Optional user message appended to the conversation before the agent loop starts. |

## AgentRunResult

```ts
interface AgentRunResult {
  result?: unknown
  writes: ChangeEvent[]
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>
  usage: { tokens: number; duration: number }
}
```

| Field       | Type                                   | Description                                              |
| ----------- | -------------------------------------- | -------------------------------------------------------- |
| `result`    | `unknown`                              | Final result value, if any.                              |
| `writes`    | `ChangeEvent[]`                        | All events written to the entity stream during this run. |
| `toolCalls` | `Array<{ name, args, result }>`        | Record of all tool calls made during this run.           |
| `usage`     | `{ tokens: number; duration: number }` | Token count and wall-clock duration in milliseconds.     |
