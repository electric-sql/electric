---
title: 'Durable Transports for your AI SDK'
description: >-
  We've released Durable Streams based transport and session integrations for TanStack AI and the Vercel AI SDK. With turnkey hosting on Electric Cloud.
excerpt: >-
  We've released Durable Streams based transport and session integrations for TanStack AI and the Vercel AI SDK. With turnkey hosting on Electric Cloud.
authors: [thruflo]
image: /img/blog/durable-transport-ai-sdks/header.jpg
tags: [durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
---

<style scoped>
.embed-container {
  margin: 24px 0;
}
.heading-icon {
  display: inline;
  height: 29px;
  vertical-align: bottom;
}
</style>

Since [launching Durable Streams](/blog/2025/12/09/announcing-durable-streams) and our [Durable&nbsp;Sessions pattern](/blog/2026/01/12/durable-sessions-for-collaborative-ai) for collaborative AI, releasing adapters for the main AI SDKs has been our most requested feature.

Today, we've released Durable Streams based transport and session adapters for [TanStack&nbsp;AI](https://durablestreams.com/tanstack-ai) and the [Vercel&nbsp;AI&nbsp;SDK](https://durablestreams.com/vercel-ai-sdk). With&nbsp;turnkey, scalable hosting on [Electric&nbsp;Cloud](/cloud).

Use them to add resilience, resumeability and multi-user, multi-agent collaboration to your apps. With&nbsp;minimal code changes and zero infra to manage.

> [!Warning] 🚀&nbsp; Upgrade your AI apps now
> Sign up to [Electric Cloud](https://dashboard.electric-sql.com) and follow the [TanStack&nbsp;AI](https://durablestreams.com/tanstack-ai) and [Vercel&nbsp;AI&nbsp;SDK](https://durablestreams.com/vercel-ai-sdk) integration&nbsp;docs.

## Resilience and collaboration

Most AI apps break if there's [any kind of problem](/blog/2025/04/09/building-ai-apps-on-sync#resumability) with connectivity. Be it patchy network, or a navigation or re-render interrupting a long-running active generation.

[Durable Streams](/primitives/durable-streams) are the perfect solution for this. As persistent, addressable streams with a reliable delivery protocol, they provide **resilience** and **resumeability** for long-running active generations and agentic sesstions.

Integrating Durable Streams via a [Durable Sessions](/blog/2026/01/12/durable-sessions-for-collaborative-ai) pattern extends this with natural support for multi-tab, multi-device, multi-user and multi-agent collaboration.

<div class="embed-container top" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

These aspects of resilience, resumability and collaboration are key to adoption of AI apps and agentic systems. The AI SDKs are aware of the challenges and provide extension points to plug in custom transports as a solution.

## <img src="/img/icons/tanstack.svg" class="heading-icon" /> TanStack AI

[TanStack AI](https://tanstack.com/ai) is a type-safe, framework agnostic AI SDK.

It provides a unified interface across multiple LLM providers. With no vendor lock-in and no proprietary formats &mdash; just clean TypeScript and honest open source.

### Connection adapter

TanStack AI provides a [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) extension point to customise the communication between your client and server.

Our [Durable connection adapter](https://durablestreams.com/tanstack-ai) uses this to add resilience, resumeability and collaboration to TanStack AI apps.

### How it works

When your `ChatClient` initializes, it fetches any existing message history and establishes a subscription to a Durable Stream.

Writes (user messages, tool calls, streaming LLM responses, etc.) are all piped-into and consumed-from the stream. This makes the client <> server communication resilient and unlocks support for multiple concurrent messages and token streams.

Any client connecting to the session subscribes and writes to the same stream. This naturally keeps everything in sync, in real-time, across tabs, devices, users and agents.

Because the session data is persisteed, clients can also read, join and fork the session at any time. Enabling async collaboration, auditability and decision traces.

::: details Message history and resumability

Resumability requires the ability to load the initial message history for the session before then resuming the active subscription.

Message history can be stored in many ways. For example, it can be read and materialized directly from the session stream. Or many apps may prefer to materialize and store messages in a database like Postgres.

As a result, the design of these durable transport integrations follows the principle of ***inversion of control***. Rather than prescribing how to handle message history, they put you in control of how you choose to handle message persistence and retrival.

:::

### Example

In your TanStack AI app, on the server, in your `/api/chat` handler (or wherever you're instructing the LLM), instead of returning `toServerSentEventsResponse(stream)` use `toDurableChatSessionResponse(...)` instead:

```tsx
import { toDurableChatSessionResponse } from "@durable-streams/tanstack-ai-transport"

return toDurableChatSessionResponse({
  stream: {
    writeUrl,
    headers,
  },
  newMessages: [latestUserMessage],
  responseStream
})
```

This persists the user message into the Durable Stream, so it's part of the session history. And it pipes the streaming LLM response into the Durable Stream. It also then returns a signed stream URL so that the client can subscribe to and consume the data.

In the client, you then configure your `ChatClient`, e.g.: using the `useChat` hook, to use the Durable Stream based connection adapter:

```tsx
import { useMemo } from "react"
import { useChat } from "@tanstack/ai-react"
import { durableStreamConnection } from "@durable-streams/tanstack-ai-transport"

export function Chat({ id, initialMessages, initialOffset }) {
  const connection = useMemo(
    () =>
      durableStreamConnection({
        sendUrl: `/api/chat?id=${id}`,
        readUrl: `/api/stream?id=${id}`,
        initialOffset
      }),
    [id, initialOffset]
  )

  const { messages, sendMessage } = useChat({
    connection,
    id,
    initialMessages,
    live: true
  })

  // ...
}
```

You can pass in the `initialMessages` (the chat history so far) and the `initialOffset` (to resume the subscription from) from any source you like. So, for example, if you're storing messages in your database you can get the message history from database. Just make sure that you store the offset transactionally with the data so there aren't any race conditions.

However, the easiest way is to use our `materializeSnapshotFromDurableStream` helper function to just materialize the history from the session stream. If you do can do this in your TanStack `Route` loader, it will work client side and with SSR:

```tsx
import { materializeSnapshotFromDurableStream } from "@durable-streams/tanstack-ai-transport"

const { messages, offset } = await materializeSnapshotFromDurableStream({
  readUrl,
  headers,
})
```

With these pieces in place:

1. when the client renders, it gets the initial message history and subscribes to the session stream from the right offset
2. when `sendMessage` or `append` are called, the user message is sent to your backend as normal; you handle it as normal, with your current AI engineering and LLM provider instruction
3. when the LLM provider streams the response back, `toDurableChatSessionResponse` streams the active generation onto the Durable Stream
4. all clients subscribe to the same stream and reactively update whenever any data syncs in; no matter which user or agent it came from, with support for multiple interleaved concurrent generations

It's a sync-based architecture that is really the [only sane way to build AI apps](/blog/2025/04/09/building-ai-apps-on-sync). With all the complex durability, message delivery and distributed data stuff handled for you.

## <img src="/img/integrations/vercel.svg" class="heading-icon" /> Vercel AI SDK

The [Vercel AI SDK](https://ai-sdk.dev) is an AI toolkit for TypeScript.

### Durable transport

The Vercel AI SDK has a [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) interface.

Our [Durable Transport](https://durablestreams.com/vercel-ai-sdk) uses this to add resilience, resumeability and collaboration to AI SDK apps.

### Example

Swap the default transport for `createDurableChatTransport`:

```typescript
import { useChat } from "@ai-sdk/react"
import { createDurableChatTransport } from "@durable-streams/aisdk-transport"

const transport = createDurableChatTransport({ api: "/api/chat" })
const chat = useChat({ transport, resume: true })
```

Then on the server, wrap the AI SDK UI message stream with `toDurableStreamResponse`:

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

## Next steps

- sign up to [Electric Cloud](https://dashboard.electric-sql.com)
- follow the [integration&nbsp;docs](https://durablestreams.com)
- any questions, let us know in [Discord](https://discord.electric-sql.com)
