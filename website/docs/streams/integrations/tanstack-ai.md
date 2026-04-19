---
title: TanStack AI
description: >-
  TanStack AI connection adapter for Durable Streams. Make chat sessions resumable, resilient, and shareable across tabs, devices, users and agents.
outline: [2, 3]
---

<img src="/img/icons/tanstack.svg" width="64px" />
<br />

# TanStack AI

[TanStack AI](https://tanstack.com/ai) is a type-safe, framework agnostic AI SDK.

It provides a unified interface across multiple LLM providers. With no vendor lock-in and no proprietary formats &mdash; just clean TypeScript and honest open source.

<IntentLink intent="create" serviceType="streams" serviceVariant="tanstack-ai" />

## Resilience and collaboration

TanStack AI provides a [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) interface that allows you to customise the communication between your client and server when building TanStack AI apps.

The Durable Streams TanStack AI integration provide a durable connection adapter that adds Durable Stream based resilience and collaboration to your app.

This allows your app to:

1. [work across patchy connectivity](https://electric-sql.com/blog/2025/04/09/building-ai-apps-on-sync), page refreshes, re-renders, etc.
2. [support multi-user and multi-agent collaboration](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai) across multiple tabs and devices, both asynchronously and in real-time

## How it works

The durable connection adapter swaps out the default request <> response interaction paradigm of the TanStack AI [`ChatClient`](https://tanstack.com/ai/latest/docs/api/ai-client) for a sync-based paradigm.

When your chat client initializes, it fetches any existing message history and then establishes a subscription to a Durable Stream. Any writes (user messages, tool calls, token streams, etc.) are all written to and consumed via the Durable Stream.

Because Durable Streams are resilient and resumeable, with exactly-once message delivery into web and mobile clients across the public Internet, this makes the client <> server communication layer of your app resilient.

Then, because any client connecting to the same session subscribes and writes to the same Durable Stream, this naturally works across tabs, devices, users and agents. Both in real-time and asynchronously &mdash; clients can read, join and fork the session at any time.

We call this the [Durable Session pattern](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai) for building resilient, collaborative AI apps.

<div class="embed-container top" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

### Initial message history

Resumability requires the ability to load the initial message history for the session before then resuming the active subscription.

Message history can be stored in many ways. For example, it can be read and materialized directly from the session stream. Or many apps may prefer to materialize and store messages in a database like Postgres.

As a result, the design of the Durable Streams TanStack AI integration follows the principle of **_inversion of control_**. Rather than prescribing how to handle message history, the integration puts you in control of how you handle persistence and retrival.

If you choose to materialize the history from the session stream, you can use the provided `materializeSnapshotFromDurableStream` helper function. Or you can load the history from any other source or data store.

## Usage

### Install

Install the dependencies:

```bash
pnpm add @durable-streams/client @durable-streams/tanstack-ai-transport
```

### Client

In your client, create a durable connection adapter:

```tsx
import { durableStreamConnection } from "@durable-streams/tanstack-ai-transport"

const connection = durableStreamConnection({
  sendUrl: "/api/chat?id=chat_123",
  readUrl: "/api/chat-stream?id=chat_123",
  initialOffset: undefined,
})
```

Pass this connection to your `ChatClient`, e.g.: using the `useChat` hook from a package like [`@tanstack/ai-react`](https://tanstack.com/ai/latest/docs/api/ai-react).

## Server

Write model chunks to a durable chat session stream:

```typescript
import { toDurableChatSessionResponse } from "@durable-streams/tanstack-ai-transport"

return toDurableChatSessionResponse({
  stream: {
    writeUrl,
    headers,
  },
  newMessages: [latestUserMessage],
  responseStream,
})
```

This appends the new user message, pipes TanStack AI chunks into the durable stream, and returns an empty success response.

## Recommended chat session flow

### 1. Client connection

```typescript
const connection = durableStreamConnection({
  sendUrl: `/api/chat?id=${chatId}`,
  readUrl: `/api/chat-stream?id=${encodeURIComponent(chatId)}`,
  initialOffset: resumeOffsetFromSSR,
})
```

Use it with `useChat`, following the same pattern as TanStack AI's [connection adapters](https://tanstack.com/ai/latest/docs/guides/streaming#connection-adapters):

```typescript
useChat({ id: chatId, connection, live: true })
```

### 2. POST route

Your `POST /api/chat` route should:

- validate the chat id
- build a durable stream write URL
- keep `newMessages` explicit, usually just the latest prompt
- start the model `responseStream`
- return `toDurableChatSessionResponse(...)`

### 3. GET proxy route

Your `GET /api/chat-stream` route should:

- accept a chat `id`
- build the upstream durable read URL on the durable stream server
- forward read query params like `offset` and `live`
- add durable stream server-side read auth headers
- return the upstream body and headers

### 4. SSR hydrate and resume

For page loaders, use:

```typescript
const { messages, offset } = await materializeSnapshotFromDurableStream({
  readUrl,
  headers,
})
```

Then send `messages` and `offset` to the client, and use that `offset` as `initialOffset` when creating the durable connection. This avoids replaying the entire session during first subscribe.

> [!Warning] 🪧&nbsp; See the example source code
> See the [package README](https://github.com/durable-streams/durable-streams/blob/main/packages/tanstack-ai-transport/README.md) and [chat example](https://github.com/durable-streams/durable-streams/tree/main/examples/chat-tanstack/) for more comprehensive example code.
