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
  model: string | Model<any>
  provider?: KnownProvider
  tools: AgentTool[]
  streamFn?: StreamFn
  getApiKey?: (
    provider: string
  ) => Promise<string | undefined> | string | undefined
  onPayload?: SimpleStreamOptions["onPayload"]
  testResponses?: string[] | TestResponseFn
}
```

## Fields

| Field           | Type                         | Required | Description                                                                                         |
| --------------- | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `systemPrompt`  | `string`                     | Yes      | System prompt sent to the LLM on each step.                                                         |
| `model`         | `string \| Model<any>`       | Yes      | Model identifier (e.g. `"claude-sonnet-4-5-20250929"`) or a resolved model object.                  |
| `provider`      | `KnownProvider`              | No       | Provider to use when `model` is a string. Defaults to `"anthropic"`.                                |
| `tools`         | `AgentTool[]`                | Yes      | Tools available to the LLM. Spread `ctx.electricTools` when your runtime host provides runtime-level tools. See [`AgentTool`](./agent-tool). |
| `streamFn`      | `StreamFn`                   | No       | Optional streaming callback passed to the underlying agent.                                         |
| `getApiKey`     | `(provider) => string \| Promise<string> \| undefined` | No | Optional API-key resolver passed through to the model layer. |
| `onPayload`     | `SimpleStreamOptions["onPayload"]` | No | Optional callback for raw streaming payloads from the model layer. |
| `testResponses` | `string[] \| TestResponseFn` | No       | Mock LLM responses for testing. When set, no real LLM calls are made.                               |

## TestResponseFn

```ts
type TestResponseFn = (
  message: string,
  bridge: OutboundBridgeHandle
) => Promise<string | undefined>
```

A function that receives the current trigger message and an outbound bridge, then returns a mock response string. Returning `undefined` emits no automatic text response.

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

| Field       | Type                                   | Description                                                                 |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `result`    | `unknown`                              | Optional final result from the underlying agent adapter.                    |
| `writes`    | `ChangeEvent[]`                        | Currently returned as an empty array placeholder.                           |
| `toolCalls` | `Array<{ name, args, result }>`        | Currently returned as an empty array placeholder.                           |
| `usage`     | `{ tokens: number; duration: number }` | Currently returned as `{ tokens: 0, duration: 0 }` until usage aggregation is wired in. |
