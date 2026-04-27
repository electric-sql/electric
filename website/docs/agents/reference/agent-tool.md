---
title: AgentTool
titleTemplate: "... - Electric Agents"
description: >-
  Interface reference for AgentTool: name, description, TypeBox parameters schema, and execute function.
outline: [2, 3]
---

# AgentTool

Interface for tools the LLM can call during the agent loop. Re-exported from `@mariozechner/pi-agent-core`.

**Source:** `@electric-ax/agents-runtime` (re-export)

```ts
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string
  label: string
  description: string
  parameters: TParameters
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>
}
```

## Fields

| Field         | Type                                                                   | Required | Description                                                          |
| ------------- | ---------------------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `name`        | `string`                                                               | Yes      | Unique tool name used in LLM function calling.                       |
| `label`       | `string`                                                               | Yes      | Human-readable label for display.                                    |
| `description` | `string`                                                               | Yes      | Description sent to the LLM to explain when and how to use the tool. |
| `parameters`  | `TSchema`                                                              | Yes      | TypeBox JSON Schema defining the tool's parameters.                  |
| `execute`     | `(toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>` | Yes      | Function called when the LLM invokes the tool.                       |

Parameters are defined using [TypeBox](https://github.com/sinclairzx81/typebox) (`@sinclair/typebox`). The schema is used for LLM function calling and argument validation.

## AgentToolResult

```ts
interface AgentToolResult<T = any> {
  content: (TextContent | ImageContent)[]
  details: T
}
```

| Field     | Type                              | Description                                                              |
| --------- | --------------------------------- | ------------------------------------------------------------------------ |
| `content` | `(TextContent \| ImageContent)[]` | Content returned to the LLM. Typically `{ type: 'text', text: string }`. |
| `details` | `T`                               | Arbitrary metadata. Must be provided (use `{}` if no details).           |

::: warning
Every tool must return a `details` property. Omitting it causes a type error.
:::
