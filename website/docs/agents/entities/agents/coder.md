---
title: Coder
titleTemplate: "... - Electric Agents"
description: >-
  Built-in coding-session entity backed by Claude Code or Codex CLI.
outline: [2, 3]
---

# Coder

`coder` is the built-in coding-session entity. It runs a Claude Code or Codex CLI session in a working directory, mirrors the normalized session event stream into entity state, and can be prompted repeatedly across many turns.

**Source:** [`packages/agents/src/agents/coding-session.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/agents/coding-session.ts)

## Spawn args

```ts
interface CoderArgs {
  agent: "claude" | "codex"
  cwd?: string
  nativeSessionId?: string
  importFrom?: { agent: "claude" | "codex"; sessionId: string }
}
```

| Field             | Required | Description |
| ----------------- | -------- | ----------- |
| `agent`           | Yes      | CLI backend to run: `"claude"` or `"codex"`. |
| `cwd`             | No       | Working directory for the CLI. Defaults to the built-in runtime working directory. |
| `nativeSessionId` | No       | Attach to an existing local Claude/Codex session. |
| `importFrom`      | No       | Import an existing local session into a new session for the selected backend. |

The built-in runtime registers `coder` during bootstrap. Handler code can also call `registerCodingSession(registry, { defaultWorkingDirectory, cliRunner? })` from `@electric-ax/agents`.

## Prompt messages

The preferred inbox message type is `prompt` with a payload shaped like:

```ts
interface PromptMessage {
  text: string
}
```

Generic messages with the same `{ text }` payload are also processed, so the dashboard and CLI can send prompts without a custom message type.

## State collections

`coder` adds three custom state collections:

| Collection      | Event type              | Description |
| --------------- | ----------------------- | ----------- |
| `sessionMeta`   | `coding_session_meta`   | Current session metadata: selected backend, cwd, status, native session id, and errors. |
| `cursorState`   | `coding_session_cursor` | Serialized tail cursor and the last processed inbox key. |
| `events`        | `coding_session_event`  | Normalized `agent-session-protocol` events mirrored from the CLI session. |

## Handler behavior

1. Initializes session metadata and cursor state if needed.
2. Mirrors existing local session history when attaching or importing.
3. Processes pending prompt messages in inbox order.
4. Calls `ctx.recordRun()` around each CLI invocation so parents observing with `wake: "runFinished"` are notified.
5. Mirrors new CLI events into the `events` collection and appends assistant text as the run response.
6. Updates `sessionMeta.status` to `idle` or `error`.

## Handler API

Inside another entity handler, use `ctx.useCodingAgent()` to spawn or attach to a coder:

```ts
const coder = await ctx.useCodingAgent("feature-work", {
  agent: "claude",
  cwd: process.cwd(),
})

coder.send("Implement the requested feature and run the tests.")
await coder.run
```

`useCodingAgent()` returns a `CodingSessionHandle` with `entityUrl`, `status()`, `meta()`, `send(prompt)`, `run`, `events`, and `messages`.

## Horton tools

Horton usually interacts with coders through:

| Tool           | Purpose |
| -------------- | ------- |
| `spawn_coder`  | Creates a new long-lived `coder`, sends the first prompt, and wakes Horton when the reply lands. |
| `prompt_coder` | Sends a follow-up prompt to an existing coder URL. |

## Details

| Property          | Value |
| ----------------- | ----- |
| Type name         | `coder` |
| Backends          | Claude Code and Codex CLI |
| State             | `sessionMeta`, `cursorState`, `events` |
| Wake support      | Uses `ctx.recordRun()` so `runFinished` observers work |
| Working directory | From spawn args or `registerCodingSession` default |
