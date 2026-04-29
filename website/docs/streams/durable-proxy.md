---
title: Durable Proxy
description: >-
  Put durable, resumable streaming in front of existing AI streaming APIs. Persists upstream responses into Durable Streams so clients can reconnect and resume reads.
outline: [2, 3]
---

# Durable Proxy

Use `@durable-streams/proxy` when you want to put durable, resumable streaming in front of existing AI streaming APIs.

The proxy forwards requests to an upstream provider, persists the streaming response into Durable Streams, and gives clients a durable read URL they can reconnect to.

## Install

```bash
pnpm add @durable-streams/proxy
```

## Start a proxy server

```typescript
import { createProxyServer } from "@durable-streams/proxy"

const server = await createProxyServer({
  port: 4440,
  durableStreamsUrl: "http://localhost:4441",
  jwtSecret: process.env.JWT_SECRET,
  allowlist: ["https://api.openai.com/**", "https://api.anthropic.com/**"],
})

console.log(`Proxy running at ${server.url}`)
```

## Durable fetch

```typescript
import { createDurableFetch } from "@durable-streams/proxy/client"

const durableFetch = createDurableFetch({
  proxyUrl: "https://my-proxy.example.com/v1/proxy",
  proxyAuthorization: "service-secret",
  autoResume: true,
  storage: localStorage,
})

const response = await durableFetch(
  "https://api.openai.com/v1/chat/completions",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer sk-...",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    }),
    requestId: "conversation-123",
  }
)
```

`requestId` lets the client resume the same durable stream across refreshes and reconnects.

## When to use it

- Use the proxy when you already have an SSE or streaming AI endpoint and want resumability without changing the upstream protocol.
- Use [Vercel AI SDK](integrations/vercel-ai-sdk) when you are integrating directly with Vercel AI SDK.
- Use [TanStack AI](integrations/tanstack-ai) when you want the TanStack AI transport adapter.

## More

- [Proxy README](https://github.com/durable-streams/durable-streams/blob/main/packages/proxy/README.md)
- [Proxy protocol](https://github.com/durable-streams/durable-streams/blob/main/packages/proxy/PROXY_PROTOCOL.md)
