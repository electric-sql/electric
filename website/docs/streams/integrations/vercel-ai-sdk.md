---
title: Vercel AI SDK
description: >-
  Vercel AI SDK Transport that makes chat sessions resumable, resilient, and shareable across tabs, devices, users and agents.
outline: [2, 3]
---

<img src="/img/icons/vercel.svg" width="56px" />
<br />

# Vercel AI SDK

Use `@durable-streams/aisdk-transport` to make [Vercel AI SDK](https://ai-sdk.dev) `useChat` generations durable and resumable and shareable across tabs, devices, users and agents.

This is the integration to use when you want a chat generation to survive refreshes and reconnect cleanly to the same stream. It plugs into the AI SDK's [Transport layer](https://ai-sdk.dev/docs/ai-sdk-ui/transport#transport), so you can keep the normal `useChat` flow while swapping in a durable transport.

## Install

```bash
pnpm add @durable-streams/aisdk-transport
```

## Client

Swap the default transport for `createDurableChatTransport`, following the same transport model documented in the AI SDK [transport docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport#transport):

```typescript
import { useChat } from "@ai-sdk/react"
import { createDurableChatTransport } from "@durable-streams/aisdk-transport"

const transport = createDurableChatTransport({ api: "/api/chat" })
const chat = useChat({ transport, resume: true })
```

## Server

Wrap the AI SDK UI message stream with `toDurableStreamResponse`:

```typescript
import { toDurableStreamResponse } from "@durable-streams/aisdk-transport"

return toDurableStreamResponse({
  source: result.toUIMessageStream(),
  stream: {
    writeUrl: buildWriteStreamUrl(streamPath),
    readUrl: buildReadProxyUrl(request, streamPath),
    headers: DURABLE_STREAMS_WRITE_HEADERS,
  },
})
```

The server writes AI SDK chunks into Durable Streams and returns the read URL through `Location` and `{ streamUrl }`.

## Resume flow

For refresh-safe generations:

1. Persist the active stream id for the chat while generation is in progress.
2. Add a reconnect endpoint such as `GET /api/chat/:id/stream`.
3. Return `204` when there is no active generation, or `200` plus `Location` and `{ streamUrl }` when there is one.
4. Enable `resume: true` in `useChat`.

## Example

See the working example in:

- [Package README](https://github.com/durable-streams/durable-streams/blob/main/packages/aisdk-transport/README.md)
- [Example app](https://github.com/durable-streams/durable-streams/tree/main/examples/chat-aisdk)
