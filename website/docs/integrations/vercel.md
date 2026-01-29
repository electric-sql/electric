---
outline: deep
title: Vercel - Integrations
description: >-
  How to use Electric with Vercel, including Durable Transport for the Vercel AI SDK.
---

<img src="/img/integrations/vercel.svg" class="product-icon" />

# Vercel

[Vercel](https://vercel.com) is a cloud platform for deploying and hosting web applications.

## Electric and Vercel

Electric integrates with Vercel in two main ways:

1. **Hosting** &mdash; deploy Electric-powered applications on Vercel's platform
2. **Durable Transport** &mdash; use [Durable&nbsp;Streams](/products/durable-streams) with the [Vercel AI SDK](https://sdk.vercel.ai)

## Durable Transport for AI

The Vercel AI SDK is a popular toolkit for building AI-powered applications. Electric's [Durable&nbsp;Streams](/products/durable-streams) provide a **Durable Transport** layer that makes AI token streams resilient to network interruptions.

### Why Durable Transport?

Standard AI streaming is fragile:

- Network interruptions lose partial responses
- Users must restart failed requests from scratch
- Mobile connections and poor WiFi cause frequent failures

Durable Transport solves this by:

- **Persisting** the token stream on the server
- **Resuming** from the last received position on reconnect
- **Guaranteeing** exactly-once delivery of tokens

### Installation

```bash
npm install @electric-sql/durable-streams
```

### Usage with Vercel AI SDK

```typescript
import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { durableTransport } from '@electric-sql/durable-streams'

// Wrap your AI stream with Durable Transport
const result = await streamText({
  model: openai('gpt-4'),
  prompt: 'Write a story about a robot learning to paint.',
  experimental_transport: durableTransport({
    // Configure persistence and resumption
    streamId: 'user-session-123',
  }),
})
```

### Learn more

- [Durable&nbsp;Streams documentation](/products/durable-streams)
- [Vercel AI SDK documentation](https://sdk.vercel.ai)
- [Durable&nbsp;Streams GitHub](https://github.com/electric-sql/durable-streams)

## Deploying Electric on Vercel

You can deploy Electric-powered applications on Vercel. For the Electric sync service itself, you'll need a hosting platform that supports long-running processes.

See the [Deployment guide](/docs/guides/deployment) for more details on hosting Electric.
