---
title: Testing
titleTemplate: "... - Electric Agents"
description: >-
  Test entity handlers with testResponses for LLM mocking, plus unit and integration testing patterns.
outline: [2, 3]
---

# Testing

## testResponses

Test agent handlers without calling the LLM by providing canned responses:

```ts
ctx.useAgent({
  systemPrompt: "...",
  model: "claude-sonnet-4-5-20250929",
  tools: [...ctx.electricTools],
  testResponses: ["Hello! How can I help?"],
})
await ctx.agent.run()
```

Responses are consumed in order. Each string becomes the agent's text output for that turn.

## TestResponseFn

For dynamic test responses, provide a function instead of an array:

```ts
testResponses: async (message, bridge) => {
  bridge.onTextStart()
  bridge.onTextDelta("Test response")
  bridge.onTextEnd()
  return "Test response"
}
```

The `bridge` parameter gives control over text-level events, letting you simulate tool calls, reasoning steps, and multi-turn interactions. Returning a string emits it as a text block automatically.

::: info Runtime-managed lifecycle
The runtime wraps your `TestResponseFn` with `bridge.onRunStart()` / `bridge.onRunEnd()` and step start/end calls automatically. Do not call these yourself — only use text-level bridge methods (e.g. `onTextStart`, `onTextDelta`, `onTextEnd`) or tool-level methods inside the function.
:::

## Unit testing entity registration

```ts
import { createEntityRegistry } from "@electric-ax/agents-runtime"

const registry = createEntityRegistry()
registerAssistant(registry)

test("registers assistant", () => {
  const entry = registry.get("assistant")
  expect(entry).toBeDefined()
  expect(entry!.definition.handler).toBeTypeOf("function")
})
```

## Unit testing runtime creation

```ts
test("creates runtime with types", () => {
  const runtime = createRuntimeHandler({
    baseUrl: "http://localhost:4437",
    serveEndpoint: "http://localhost:3000/webhook",
    registry,
  })
  expect(runtime.typeNames).toContain("assistant")
})
```

## Integration testing

Integration testing with the full Electric Agents server is possible using the `@electric-ax/agents-server-conformance-tests` package, which provides test server utilities for running against a live server instance.
