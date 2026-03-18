---
title: 'Durable Transport for your AI SDK'
description: >-
  We've released Durable Transport integrations that add resilience and collaboration to TanStack AI and the Vercel AI SDK. With turnkey hosting on Electric Cloud.
excerpt: >-
  We've released Durable Transport integrations that add resilience and collaboration to TanStack AI and the Vercel AI SDK. With turnkey hosting on Electric Cloud.
authors: [thruflo]
image: /img/blog/durable-transport-ai-sdks/header.jpg
tags: [durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
---

We've released Durable Transports for [TanStack&nbsp;AI](https://durablestreams.com/tanstack-ai) and the Vercel [AI&nbsp;SDK](https://durablestreams.com/vercel-ai-sdk).

With&nbsp;turnkey hosting on [Electric&nbsp;Cloud](/cloud), for drop-in resilience and multi-user, multi-agent collaboration, with persistent sessions, <span class="no-wrap">ultra-low</span> latency and zero infrastructure to manage.

> [!Warning] 🚀&nbsp; Drop-in to your app now
> [Sign up to Electric Cloud](https://dashboard.electric-sql.com) and follow the integration docs for [TanStack AI](https://durablestreams.com/tanstack-ai) and the [Vercel AI SDK](https://durablestreams.com/vercel-ai-sdk).

## Resilience and collaboration

Since [launching Durable Streams](/blog/2025/12/09/announcing-durable-streams) and sharing our [transport prototypes](https://github.com/electric-sql/transport) and [Durable Sessions](/blog/2026/01/12/durable-sessions-for-collaborative-ai) pattern for collaborative AI, releasing durable transports for the main AI SDKs has been our most requested feature.

<div class="embed-container top" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

### Resilience and resumeability

AI apps built using the [default request <> response paradigm](#sessions-post) of the AI SDKs break if there's [any kind of problem](/blog/2025/04/09/building-ai-apps-on-sync#resumability) interrupting the request. Be it patchy connectivity, user refreshing the page, something triggers a re-render, etc.

[Durable Streams](/products/durable-streams) are the perfect solution for this. As persistent, addressable streams with a reliable delivery protocol, they provide **resilience** and **resumeability** for AI instruction requests and agentic sesstions.

### Multi-user, multi-agent collaboration

Apps that swap out the default request <> response paradigm for a [sync-based paradigm backed by a Durable Stream](/blog/2026/01/12/durable-sessions-for-collaborative-ai) also naturally add support for multi-user, multi-agent collaboration.

Any client connecting to the same session naturally subscribes and writes to the same Durable Stream. This keeps clients in sync across tabs, devices, users and agents. Both for collaboration in the moment, with users and agents interacting in **real-time** and **asynchronously** — with clients able to read, join, fork and share the session at any time.

### Message history and resumability

Resumability requires the ability to load the initial message history for the session before then resuming the active subscription.

Message history can be stored in many ways. For example, it can be read and materialized directly from the session stream. Or many apps may prefer to materialize and store messages in a database like Postgres.

As a result, the design of the Durable Streams integrations follows the principle of inversion of control. Rather than prescribing how to handle message history, they put, as the application developer, in control of how you handle persistence and retrival.

## Durable Transports

These aspects of resilience, resumability and collaboration are key to adoption of AI apps and agentic systems. The AI SDKs are aware of the challenges and provide extension points to plug in custom transports as a solution.

TanStack AI has [Connection Adapters](https://tanstack.com/ai/latest/docs/guides/connection-adapters) and [custom fetch client](https://tanstack.com/ai/latest/docs/guides/connection-adapters#server-sent-events-sse) support.

For example:

```tsx
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react'

function Page() {
  const { messages } = useChat({
    connection: fetchServerSentEvents('/api/chat', {
      fetchClient: myCustomFetch
    })
  })

  // ...
}
```

The Vercel AI SDK has a [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) interface and the [`resumeable-stream`](https://github.com/vercel/resumable-stream) library.

This release from Electric now provides dedicated transporty and connection adapters that use Durable Streams to provide resilience, resumeability and collaboration support in a way that's drop in compatible with existing AI SDK apps.

### Drop-in resilience

Both integrations are based on a [durable fetch client](https://github.com/durable-streams/durable-streams/blob/main/packages/proxy/src/client/durable-fetch.ts) that talks to a [`@durable-streams/proxy`](https://github.com/durable-streams/durable-streams/tree/main/packages/proxy) server. For example, for simple resilience with TanStack AI:

```tsx
import { createDurableFetch } from '@durable-streams/proxy/client'

// Get from the Electric Cloud or host your
// own `@durable-streams/proxy` service.
const PROXY_URL = import.meta.env.PROXY_URL

const durableFetch = createDurableFetch({
  proxyUrl: PROXY_URL
})

// Pass the durable fetch client to the
// default connection adapter.
function Page() {
  const { messages } = useChat({
    connection: fetchServerSentEvents('/api/chat', {
      fetchClient: durableFetch
    })
  })

  // ...
}
```

When your chat client sends a message to your `/api/chat` endpoint, the durable fetch client intercepts the request and sends it to the `@durable-streams/proxy` service. The proxy sends the request through to your API, streams the response into a Durable Stream and returns the URL of the stream.

The client then uses this URL to connect to the stream and consume the response using the `@durable-streams/client`. This makes instruction requests and long running active-generations resilient to both patchy connectivity and tab backgrounding.

The next step is to move from resilience to resumeability.

### Resumeability and re-connection

As we've just seen, the durable fetch client handles some resumeability of active generations. However, what if the user refreshes the page? Or what if the active generation is happening in the background whilst the user navigates to another view in your application, unmounting the chat client component?

What you need in this case is the ability to reconnect to a session at any time and resume any ongoing active generations.

### Persistence and active generations

The challenge is that active generations don't exist in isolation. There's no point resuming an active generation without also persisting and hydrating the previous message history. Otherwise you'd just be rendering an LLM response without any of the preceeding context or user messages.

There are a number of ways to approach this. You can persist the message history locally, in localStorage (or similar). You can implement a [comprehensive Durable Session pattern](/blog/2026/01/12/durable-sessions-for-collaborative-ai), combining message history and session state with backend APIs for handling writes to the session.

Or there is a middle way. Which is to use the `@durable-streams/proxy` service's ability to re-use an existing stream across multiple requests.

### Resumeable single-user session

This works by creating a Durable Stream for the converation or session. You tell the proxy to always append responses to this same stream. This allows you to load the message history and resume any active generations when reconnecting or rendering.

```tsx
import { createDurableConnection } from "@durable-streams/proxy/client"
import { useSessionStream, useResumeableSession } from "@durable-streams/proxy/react"

const PROXY_URL = import.meta.env.PROXY_URL

function Page({ chatId }) {
  // Get or create the session stream.
  const sessionStream = useSessionStream(chatId, PROXY_URL)

  // Tell the durable fetch client to tell
  // the proxy to use the session stream.
  const durableFetch = createDurableFetch({
    proxyUrl: PROXY_URL,
    sessionStream
  })

  const { messages, setMessages } = useChat({
    connection: fetchServerSentEvents('/api/chat', {
      fetchClient: durableFetch
    })
  })

  // Load the initial message history from the
  // stream and resume any active generations.
  useResumeableSession(sessionStream, setMessages)

  // ...
}
```

This gives you resilience, resumeability and the ability to reconnect to and re-render a session at any time. It also allows you to render the same session across tabs and/or devices.











[Durable Transport]() and [Durable Connection Adapters]() for the Vercel AI SDK and TanStack AI, respectively.

See [the docs]() for more info but the usage is very simple:

```tsx

```








we released transports!
demo video refreshing during live transmision, here's how to add it to your project, reiterate why DS is awesome
built on common durable sse proxy package — works with any SSE
implementation in cloud + reference server backed on conformance test suite — ensures oss & cloud stay in common. Same as server/client implementations. You can implement durable proxies in any API
layered model for DS — we'll be releasing a lot more protocols, yjs is next — let us know what else you'd like
thruflo — Yesterday at 10:48 AM
Yup, my notes whilst at it:

transports!
drop in
Cloud
Wrapper protocols
Power of the conformance suite
Yjs, automerge, LiveStore coming soon
AnyCable