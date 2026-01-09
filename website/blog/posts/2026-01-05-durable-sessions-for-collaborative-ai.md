---
title: Durable Sessions — the key pattern for collaborative AI
description: >
  This post introduces the Durable Session pattern for building collaborative AI apps with Durable Streams and TanStack DB.
excerpt: >
  As the world moves to getting things done through agents, the winners are going to be the products that combine AI with team-based collaboration. Building AI apps on a Durable Sessions architecture is the best way to do that.
authors: [thruflo]
image: /img/blog/durable-sessions-for-collaborative-ai/header.jpg
imageWidth: 1536
imageHeight: 947
tags: [agents, collaboration, durable-streams, tanstack-db]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'

import RequestResponse from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.jpg?url'
import RequestResponseSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.sm.jpg?url'
</script>

<style scoped>
  figure {
    margin: 24px 0 !important;
    border-radius: 14px !important;
    overflow: hidden;
  }
  .embed-container {
    margin: 24px 0;
    border-radius: 2px;
    overflow: hidden;
  }
  .embed-container.top {
    margin: 32px 0 -12px 0;
  }
</style>

As the world moves to getting things done through agents, the winners are going to be the products that integrate AI with team-based collaboration.

This post introduces the [Durable Sessions](#durable-sessions) pattern and shows how you can implement it using [Durable Streams](https://github.com/durable-streams/durable-streams) and [TanStack DB](https://tanstack.com/db) to add collaboration to your AI SDK.

> [!Warning] 🤝 ✨ Durable Sessions demo
> See the TanStack AI - Durable Sessions [demo video](https://youtu.be/81KXwxld7dw) and [source code](https://github.com/electric-sql/transport).

<div class="embed-container top" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

## Getting things done with agents

When I sit down to get something done, I increasingly reach for an agent. Not because they're magic or perfect but because, on balance, they boost my productivity.

For me, personally, as a technical startup founder, adapting to this new reality is a challenge. I spent the last however many years developing craft skills that are now somehow being both amplified and commoditized at the same time.

<figure>
  <Tweet tweet-id="2004646160200511615"
      align="center"
      conversation="none"
      theme="dark"
  />
</figure>

For people with less technical craft skills or who are less used to adaptation, the challenge to evolve is even harder. For companies, made up of people working in management structures, the challenge is existential. Teams, departments, whole industries &mdash; [why do they even exist](https://x.com/justjake/status/2009459155913044354) any more?

### Right place, right time

As a software engineer and a product builder, if you've ever wanted to be in the right place at the right time, you are right now.

You have the opportunity to disrupt and replace whole swathes of previous-generation software. Right as the market is expanding wildly, as software eats into the rump of white-collar payroll spend.

### Cracking the enterprise

It's a massive economic shift, with massive customers feeling massive pain.

If you can serve their transformation, as they scramble to up-skill and transform their workforce, there's no limit to what you can achieve.

However, if you build on a single user paradigm, it's not going to cut it. You're not going to win the procurement battle. You're not going to land and expand. You're not going to benefit from product-led growth.

> <em>&ldquo;Today, AI works impressively for individuals but disappointingly for organizations. Closing that gap requires not just more context, but treating agents as social participants in the multiplayer systems they aim to disrupt.&rdquo;</em><br />
> <small>&mdash; [Collaborative Intelligence. Aatish Nayak](https://x.com/nayakkayak/status/2009660549554913574)</small>

Instead, to crack the enterprise, you need to support the same kind of team-based collaboration that the software you're replacing was based on. That means people working together on agentic sessions.

### With collaborative AI

At the micro-level it's shared sessions, collaborative prompt editing and multi-user token streams. At the mid-level it's audit logs and history. Compliance departments reviewing context and artifacts.

At the macro-level it's weaving your software into the fabric of the enterprise. As the research, the planning, the prompts, the sessions and the outputs get threaded into the collaboration, management, reporting, access control and governance processes that the enterprise runs on.

But how do you build and adapt AI and agentic products to support this kind of collaboration? How do you unlock this level of adoption?

## Moving beyond single-user

You need to move beyond the default single‑user <> single‑agent interaction paradigm of today's AI SDKs. To a multi‑user <> multi‑agent paradigm that naturally supports both real-time and asynchronous collaboration.

### Evolving the interaction paradigm

The default paradigm of most AI SDKs, like the [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) and [TanStack AI](https://tanstack.com/ai), is single‑user <> single‑agent.

You have a chat interface with a `sendMessage` action:

```tsx
const { messages, sendMessage } = useChat({...})
```

When the user types their prompt and hits enter, you call `sendMessage`, it adds the message to some local state and then blocks the UI whilst it makes an API request to a backend endpoint. That constructs an LLM instruction request and streams the response back to the client.

```tsx
async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai(`gpt-4o`),
    prompt: convertToModelMessages(messages),
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse()
}
```

The client then consumes the response stream, writes out the agent response one chunk at a time and unblocks the chat thread once the active generation is finished.

<figure>
  <img :src="RequestResponse" class="hidden-sm" />
  <img :src="RequestResponseSmall" class="block-sm" />
</figure>

The whole flow is designed around request <> response. The request is a single user message and the response is a single assistant message.

### Support for collaboration

This fails to support collaboration in so many ways. The local message state isn't shared, so doesn't sync across users/tabs/devices. The request response model (and blocking the UI) assumes there’s only one user waiting on a response from a one agent.

What we need instead is an interaction paradigm that doesn't bake in this single user <> single agent assumption. That allows multiple users to work in multiple tabs and devices, collaborating with other users and agents on the same session in real-time. So users can join the session half way through and other users can go back to it later.

### Persistence and addressability

That means the session needs to be persistent and addressable.

This is generally left up to application developers. If you want multiple users to join the same session or multiple agents to register with it, you have to dig into application-specific routing, storage and authentication.

For example, the Vercel AI SDK [`useChat` hook](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#messages) accepts an `messages` parameter.

```tsx
// Initial chat messages to populate the conversation with.
messages?: UIMessage[]
```

Which you can pass in when you initialize a chat session. Or you can fetch asynchronously and set client side, after the UI has initialized:

```tsx
export default function Chat({ sessionId }) {
  const { messages, sendMessage, setMessages } = useChat({
    id: sessionId
  })

  useEffect(() => {
    somehow
      .fetchMessageHistory(sessionId)
      .then(setMessages)
  }, [sessionId, setMessages])

  // ...
}
```

How you use that `sessionId` to fetch the message history is up to you. How other processes or apps find, consume and subscribe to it is up to you.

Whereas what's needed is a ***standard protocol*** for persistence and addressability of streams and sessions. So initial message hydration is taken care of and external software can plug-in, audit, monitor and integrate. In the same way that today's enterprise systems monitor and audit web service APIs.

## Composable sync primitives

That's what we've been building at Electric. A suite of composable sync primitives that give you durable state that's persistent, addressable and subscribable:

- [Electric sync](#electric-sync)
- [Durable Streams](#durable-streams)
- [TanStack DB](#tanstack-db)
- [PGlite](https://pglite.dev)

They're built into tools like [Firebase](https://firebase.google.com), [Prisma](https://www.prisma.io) and [TanStack](https://tanstack.com) and used by products like [Trigger.dev](https://trigger.dev), [Turbo](https://www.turbo.ai) and [Humanlayer](https://www.humanlayer.dev).

### Electric sync

Our core product is the [Electric sync engine](https://electric-sql.com).

Electric syncs data out of Postgres into client apps, handling partial replication and fan out. Using an [HTTP-based sync protocol](/docs/api/http) that scales out data delivery through existing CDN infrastructure.

### Durable Streams

We've now generalized the Electric sync protocol into [Durable Streams](https://github.com/durable-streams/durable-streams).

This is a lower-level binary streaming protocol that supports more use cases, like token streaming, real-time presence and multi-modal binary data frames.

### TanStack DB

[TanStack&nbsp;DB](https://tanstack.com/db) is a lightweight, reactive client store with:

1. [collections](https://tanstack.com/db/latest/docs/overview#defining-collections) a unified data layer to load data into
1. [live queries](https://tanstack.com/db/latest/docs/guides/live-queries) super-fast reactivity using differential dataflow
1. [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations) that tie into the sync machinery

DB allows you to build real-time, reactive apps on any type of data, from any source. Be it your API response, Electric sync or a Durable Stream.

## Durable Sessions pattern

The Durable Session pattern composes [Durable Streams](#durable-streams) with [TanStack DB](#tsnstack-db) to provide a naturally collaborative transport layer for AI apps and agentic systems.

### Layered protocols

The key insight behind the [generalization of Electric into Durable Streams](/blog/2025/12/09/announcing-durable-streams) was not ***just*** that apps needed persistent, addressable, binary streams for presence and token streaming. (Although, of course, [they do](https://github.com/durable-streams/durable-streams?tab=readme-ov-file#the-missing-primitive)).

It was ***also*** to decouple the payload format from the delivery protocol. So the resilient, scalable, HTTP-based delivery protocol could sync ***any*** data format.

That way, the Electric sync protocol (originally modelled on the change events emitted by Postgres logical replication) becomes just ***one of many*** structured state synchronization protocols layered on top of the core binary streams.

So you have this layered framework of wrapper protocols, where durable streams are wrapped by durable state, which is wrapped by specific transport protocols:

1. [durable streams](/blog/2025/12/09/announcing-durable-streams) &mdash; persistent, addressable, payload agnostic, binary stream
1. [durable state](/blog/2025/12/23/durable-streams-0.1.0#introducing-the-state-protocol) &mdash; schema-aware structured state sync over durable stream
1. [specific protocols](/blog/2025/12/23/durable-streams-0.1.0#using-the-state-protocol) &mdash; like Postgres sync and AI SDK token streaming

### Durable transport

When it comes to building AI apps, the transport protocols are normally defined by the AI SDKs. For example, the Vercel AI SDK has a [Data Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol#data-stream-protocol).

This streams (mostly) JSON message parts over SSE:

```json
data: {"type":"start","messageId":"msg_1234"}
data: {"type":"text-start","id":"msg_1234"}
data: {"type":"text-delta","id":"msg_1234","delta":"Hello "}
data: {"type":"text-delta","id":"msg_1234","delta":" world!"}
data: {"type":"text-end","id":"msg_1234"}
data: {"type":"finish"}
data: [DONE]
```

> As you can see from the lack of message ID on the `data: {"type":"finish"}` part, it's a protocol that struggles to shake off its single user <> single agent roots. Because how do you multiplex multiple streaming messages at the same time if you don't know which message the finish applies to. And what's `[DONE]` exactly? The request or the session?

The durable state layer makes it simple to stream this kind of structured protocol, resiliently, with end-to-end type safety, over the Electric delivery protocol.

> [!Info] Example &mdash; Vercel AI SDK Transport
> The Vercel AI SDK has a [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) adapter mechanism that allows you to plug in a durable transport adapter:
>
> ```tsx
> const { messages, sendMessage } = useChat({
>   transport: new DurableTransport({...})
> })
> ```
>
> See a Durable State based [Durable Transport for the Vercel AI SDK here](https://github.com/electric-sql/transport/?tab=readme-ov-file#durable-transport).

> [!Info] Example &mdash; TanStack AI Connection Adapter
> TanStack AI has a similar [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) pattern:
>
> ```tsx
> const { messages, sendMessage } = useChat({
>   connection: durableFetch(...)
> })
> ```
>
> See a Durable State based [Durable Connection Adapter for TanStack AI here](https://github.com/electric-sql/transport/?tab=readme-ov-file#durable-transport).

### Limitations of transport

These transport adapters give you resilience and, in some cases, resumeability of active generations. However, they are still limited to request <> response. Which binds them to the single user <> single-agent interaction paradigm.

For real collaboration, we need to go beyond just patching the transport to make individual requests and their streaming responses durable and resilient. We need to patch the state management layer to <strong><em>make the <span class="no-wrap">entire session durable</span></em></strong>.

### Sync the entire session

Making the entire session durable allows us to persist multiple messages and active generations over time. You can sync any number of messages to any number of users and any number of agents. Or, for that matter, any other subscribers, workers, applications or interested parties.

In fact, using the Durable State layer, we can multiplex and transfer a variety of structured and multi-modal data both ***over time*** and ***at the same time***:

- whole messages
- token streams for active generations
- structured state for presence and agent registration
- CRDTs for typeahead indicators and cursor positions
- binary data frames for multi-modal data

Because the stream is persistent and addressable, clients can always join and catch up from their current offset at any time. Whether that's in real-time as the session is active or later on for asynchronous collaboration and historical access.

> ... diagramme ...

What we're describing is a sync-based interaction paradigm. That can combine structured state sync with efficient binary streaming. With principled management of optimistic state, tied into the sync machinery.

## Reference implementation

Which, of course, is exactly what [Durable Streams](#durable-streams) and [TanStack DB](#tanstack-db) were designed for. So, with Durable Streams and TanStack DB as composable sync primitives, the implementation becomes simple.

### Using a standard schema

You just need to provide a [Standard Schema](https://standardschema.dev) for the multiplexed message types you would like in your session ([here's an example](https://github.com/electric-sql/transport/blob/main/packages/durable-session/src/schema.ts)) and then you just have that data available in a reactive store in the client.

#### Read-path sync

1. multiplex the state protocol over a durable stream and route the message streams and session state into TanStack DB collections

```typescript
// … StreamDB code sample …
```

... type safety, reactivity, efficient ...
... pure TS so web, mobile, desktop for multi-tab, multi-device ...
... real-time multi-user ...
... durable for resumability, persistence and history -> async collaboration ...
... unified on an open protocol ...
... potential to join up into a wider client model with TanStack DB

#### Write-path actions

1. switch the `sendMessage` style actions to use TanStack DB optimistic mutations

```typescript
// … sendMessage createOptimisticAction example / usage …
```

... properly syncs user messages to multiple users and agents ...
... principled handling of optimistic state ...
... still goes via your API and your control logic ...
... nothing imposed ...

#### Session CRUD

1. implement some functions/handlers in your backend API to support creating, joining, subscribing and writing to sessions

```typescript
// … backend code sample …
```

... decouple agent instruction from request response ...
... support presence, typeahead, cursor positions ...
... register to the session or just consume the stream ...
... tie in the session registration to structured data model, e.g.: to Postgres ...
... then use alongside Electric sync and join up in the client with TanStack DB ...

### Reactive architecture

... higher level overall application archiecture diagramme ...

### Optimum AX/DX/UX

... as a result, you get an app that fully supports multi-tab, multi-device, multi-user and multi-agent. For both real-time and asynchronous collaboration. With minimal changes to your component code and zero changes to your backend AI engineering.

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

You can see a full code example and working demo app here:

- [TanStack AI <> Durable Streams <> TanStack DB durable session example](#)

## The key pattern for collaborative AI

As the world moves to getting things done through agents, the winners are going to be the products that combine AI with team-based collaboration.

Building AI apps on a Durable Sessions pattern is the best way to do that.

[Durable Streams](https://github.com/durable-streams/durable-streams) and [TanStack DB](https://tanstack.com/db) make it simple and easy to integrate Durable Sessions with your existing stack, schema and AI SDK.

### Next steps

Dive into the projects and docs for more information:

- [Electric](/docs/intro)
- [Durable Streams](https://github.com/durable-streams/durable-streams)
- [TanStack DB](https://tanstack.com/db)
- [TanStack AI](https://tanstack.com/ai)

Check out the reference implementations in the [electric-sql/transport](https://github.com/electric-sql/transport) repo:

- [Durable Transport](https://github.com/electric-sql/transport?tab=readme-ov-file#durable-transport)
- ]Durable Sessions](https://github.com/electric-sql/transport?tab=readme-ov-file#durable-sessions)

[Reach out on our Discord channel](#) if you have any questions. [Get in touch](#) if we can help speed up your integration.
